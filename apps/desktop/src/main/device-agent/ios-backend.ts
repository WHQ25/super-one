import type { DeviceOrientation } from '@superone/shared/device-agent'
import type { IosSimulatorInput } from '@superone/shared/ios-simulator'
import {
  fingerprintTree,
  findNode,
  hasSemanticGap,
  hasUsableSemantics,
  mergeRecognizedText,
  type NormalizedAccessibilityTree,
} from '../device/tree'
import { normalizeAccessibilityTree } from '../ios-simulator/a11y-tree'
import { IOS_SIMULATOR_ROTATION_DEGREES } from '@superone/shared/ios-simulator'
import {
  gestureDurationMs,
  synthesizeDoubleTap,
  synthesizeLongPress,
  synthesizePinch,
  synthesizeSwipe,
  type TouchStep,
} from '../device/gesture-synth'
import {
  encodeObservationFingerprint,
  observationFingerprintsMatch,
} from '../device/observation-fingerprint'
import { ocrToTree } from '../ios-simulator/ocr-tree'
import { settle } from '../device/settle'
import type { IosSimulatorManager } from '../ios-simulator/ios-simulator-manager'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  waitForDeviceDelay,
  type DeviceImage,
  type DeviceObservation,
  type ObserveOptions,
  type PerformContext,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

/**
 * One step of a synthesized gesture, in the vocabulary the helper speaks.
 *
 * The synthesizer decides WHERE the fingers are and WHEN, which is the part measured
 * against real guests and therefore shared; this decides how to say it down the wire,
 * which is the part that differs per transport. A `tap` stays one message because the
 * helper has a real tap for it — expanding it into a began/ended pair here would send
 * two messages where the guest expects one.
 */
function toIosSimulatorInput(step: TouchStep): IosSimulatorInput {
  return step.kind === 'tap'
    ? { type: 'tap', xRatio: step.xRatio, yRatio: step.yRatio }
    : { type: 'touch.update', contacts: step.contacts }
}

/** What one observation needs to address its own elements on the helper. */
interface ObservationAddressing {
  tree: NormalizedAccessibilityTree
  generation: number
}

/**
 * The iOS Simulator as a touch device.
 *
 * Bound to the same session the Activity panel uses, deliberately: the agent drives
 * the device the user is already watching, so a run is observable as it happens
 * rather than reconstructed from a log afterwards.
 */
export class IosSimulatorBackend implements TouchDeviceBackend {
  /**
   * Ref -> uid addressing, kept per observation rather than as "the latest read".
   *
   * A helper dump renumbers its element table wholesale, so each observation owns a
   * different mapping. Holding one mutable copy meant any observation that happened
   * after the state store was last updated -- a snapshot whose screenshot threw, a
   * wait_for poll that was then cancelled -- silently re-pointed every ref the agent
   * still had. Keyed by the observation object, the two cannot drift: an action
   * resolves through the exact tree it was aimed at, and a `press` against a snapshot
   * the helper has moved past is refused by the generation check rather than landing
   * on whatever now occupies that uid.
   */
  private readonly addressing = new WeakMap<DeviceObservation, ObservationAddressing>()

  /** The last text read from pixels, and the frame it was read from. See `readTextTree`. */
  private lastRecognized: {
    key: string
    result: { tree: NormalizedAccessibilityTree; truncated: boolean }
  } | null = null

  private deviceLabel = 'iOS Simulator'

  constructor(
    private readonly manager: IosSimulatorManager,
    private readonly sessionId: string,
  ) {}

  /** Filled in from the device once observed, so summaries can name the model. */
  get label(): string { return this.deviceLabel }

  async observe(options: ObserveOptions = {}): Promise<DeviceObservation> {
    throwIfDeviceOperationAborted(options.signal)
    const state = await this.manager.getSessionState(this.sessionId)
    throwIfDeviceOperationAborted(options.signal)
    if (!state.device || state.phase !== 'ready') {
      throw new DeviceAgentError(
        'NO_DEVICE',
        'This session controls no device. Call device_list, then device_request_control with an id from it.',
      )
    }
    this.deviceLabel = state.device.name
    const orientation = state.orientation as DeviceOrientation
    const screen = { width: state.pixelWidth ?? 0, height: state.pixelHeight ?? 0 }

    const sample = async () => {
      throwIfDeviceOperationAborted(options.signal)
      // Read together rather than in sequence: they are two views of one moment, and
      // sampling them 40ms apart during an animation pairs a tree with pixels that
      // no longer match it.
      const [dump, frameHash] = await Promise.all([
        this.manager.accessibilityDump(this.sessionId, {
          ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}),
        }).catch(() => null),
        // A device whose framebuffer cannot be read still works through the tree
        // alone, so this failing is a lost signal rather than a lost observation.
        this.manager.frameHash(this.sessionId).then(({ hash }) => hash).catch(() => undefined),
      ])
      throwIfDeviceOperationAborted(options.signal)
      if (!dump && frameHash === undefined) {
        throw new DeviceAgentError(
          'NO_DEVICE',
          'Neither the accessibility tree nor the framebuffer could be read.',
        )
      }
      return {
        dump,
        frameHash,
        tree: dump ? normalizeAccessibilityTree(dump, orientation) : null,
      }
    }

    // Settling is done here rather than in the tool so that every path into the
    // backend gets it — including the polling inside device_wait_for, which would
    // otherwise happily report a control it saw mid-transition.
    const result = options.immediate
      ? { value: await sample(), settled: false }
      : await settle(
        sample,
        ({ tree, frameHash }) => encodeObservationFingerprint(
          tree ? fingerprintTree(tree.root) : null,
          frameHash,
        ),
        {
          timeoutMs: options.settleTimeoutMs ?? 2500,
          intervalMs: Math.min(150, Math.max(options.settleTimeoutMs ?? 2500, 1)),
          same: observationFingerprintsMatch,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      )

    const { dump, frameHash } = result.value
    let tree = result.value.tree
    let truncated = dump ? !dump.complete : false

    // Reading pixels runs once, on a settled frame, and only when the tree left
    // something unread. OCR costs a few hundred milliseconds — an order of magnitude
    // more than a tree dump — so it must never be inside the settle loop; the hash is
    // what earns the right to spend it.
    //
    // Two different shapes of "unread", answered differently. A screen that named
    // nothing at all has no tree worth keeping, so the recognized one replaces it. A
    // screen that named its chrome and left a hole in the middle — Safari with a page
    // in it, a game canvas inside a native shell — keeps everything the app described
    // and gains the text from the hole. Replacing there would trade a working back
    // button for a readable page.
    if (!tree || !hasUsableSemantics(tree.root)) {
      const recognized = await this.readTextTree(orientation, options, frameHash)
      if (recognized) {
        tree = recognized.tree
        truncated = recognized.truncated
      }
    } else if (hasSemanticGap(tree.root, orientation)) {
      const recognized = await this.readTextTree(orientation, options, frameHash)
      if (recognized) {
        const merged = mergeRecognizedText(tree, recognized.tree)
        tree = merged.tree
        truncated = truncated || recognized.truncated
      }
    }

    if (!tree) {
      throw new DeviceAgentError(
        'NO_DEVICE',
        'This screen exposes no accessibility tree and no text could be read from it.',
      )
    }

    const observation: DeviceObservation = {
      root: tree.root,
      orientation,
      screen,
      settled: result.settled,
      ...(frameHash ? { frameHash } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
    this.addressing.set(observation, { tree, generation: dump?.generation ?? 0 })
    return observation
  }

  /**
   * Recover a tree from the pixels for an app that exposes no usable one.
   *
   * Deliberately a fallback and not a mode: everything above works on
   * `DeviceUiNode`, so a WebView or a game canvas gets refs, search, conditions and
   * waiting for free rather than a second vocabulary that only some screens speak.
   * What it cannot recover is left missing — see `ocrToTree`.
   */
  private async readTextTree(
    orientation: DeviceOrientation,
    options: ObserveOptions,
    frameHash?: string,
  ): Promise<{ tree: NormalizedAccessibilityTree; truncated: boolean } | null> {
    // `device_wait_for` re-observes every 200ms, and each of those observations runs
    // this. OCR costs a few hundred milliseconds, so a five-second wait on a screen
    // with a semantic gap -- a map, a photo, a WebView -- paid for it a dozen times
    // over to read the very same unchanged pixels.
    //
    // Keyed on the frame hash, which is what makes it safe: identical pixels can only
    // produce identical text, and the first frame that differs pays again.
    const cacheKey = `${frameHash ?? ''}:${options.maxNodes ?? ''}`
    if (frameHash && this.lastRecognized?.key === cacheKey) {
      return this.lastRecognized.result
    }
    try {
      const result = await this.manager.frameOcr(this.sessionId, {
        rotationDegrees: IOS_SIMULATOR_ROTATION_DEGREES[orientation],
      })
      throwIfDeviceOperationAborted(options.signal)
      const tree = ocrToTree(result.lines, orientation, {
        ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}),
      })
      const recognized = { tree, truncated: Boolean(tree.root.truncatedChildren) }
      // Only a real frame is cacheable: without a hash there is nothing to prove the
      // pixels are the same ones. A failure is never cached — the next call should be
      // free to find a helper that answers.
      if (frameHash) this.lastRecognized = { key: cacheKey, result: recognized }
      return recognized
    } catch (error) {
      if (error instanceof DeviceAgentError && error.code === 'ABORTED') throw error
      // A helper too old to recognize text, or a framebuffer that went away: the
      // caller still gets whatever the tree had.
      return null
    }
  }

  async capture(): Promise<DeviceImage> {
    const shot = await this.manager.screenshot(this.sessionId)
    const state = await this.manager.getSessionState(this.sessionId)
    return {
      path: shot.path,
      width: state.pixelWidth ?? 0,
      height: state.pixelHeight ?? 0,
    }
  }

  async perform(action: ResolvedAction, context: PerformContext): Promise<void> {
    const { signal } = context
    throwIfDeviceOperationAborted(signal)
    switch (action.kind) {
      case 'press': return this.press(action.ref, context.observation)
      case 'tap': return this.send({ type: 'tap', xRatio: action.x, yRatio: action.y })
      case 'doubleTap': return this.runGesture(synthesizeDoubleTap(action.x, action.y), signal)
      case 'longPress':
        return this.runGesture(synthesizeLongPress(action.x, action.y, action.durationMs), signal)
      case 'swipe':
        return this.runGesture(
          synthesizeSwipe(action.fromX, action.fromY, action.toX, action.toY, action.durationMs),
          signal,
        )
      case 'pinch':
        return this.runGesture(synthesizePinch(action.x, action.y, action.scale, {
          ...(action.durationMs ? { durationMs: action.durationMs } : {}),
        }), signal)
      case 'type': return this.send({ type: 'text', text: action.text })
      case 'key': return this.send({ type: 'button', button: action.button })
      case 'rotate': return this.send({ type: 'rotate', orientation: action.orientation })
      case 'keyboard': return this.send({ type: 'keyboard', connected: action.connected })
    }
  }

  private async press(ref: string, observation: DeviceObservation): Promise<void> {
    const addressing = this.addressing.get(observation)
    if (!addressing) {
      throw new DeviceAgentError(
        'STALE_STATE',
        'That snapshot did not come from this device, or has been dropped. '
        + 'Take a fresh device_snapshot before pressing.',
      )
    }
    // Named rather than reported as an unknown ref. A ref read from pixels addresses
    // no helper element, so `refs` has nothing for it, and reporting that as unknown
    // reads as a stale snapshot -- which sends the agent re-snapshotting forever
    // instead of switching to a tap.
    //
    // Asked per node, not per tree: on a merged screen the chrome is pressable and
    // only the recognized text is not, and a tree-wide answer would be wrong for
    // whichever half it did not describe.
    const node = findNode(addressing.tree.root, (candidate) => candidate.ref === ref)
    if (node?.source === 'ocr') {
      throw new DeviceAgentError(
        'UNSUPPORTED',
        `${ref} was read from the pixels, so it is not an accessibility element to press. `
        + 'Use tap, which aims at its centre.',
      )
    }
    const uid = addressing.tree.refs.get(ref)
    if (uid === undefined) {
      throw new DeviceAgentError('UNKNOWN_REF', `${ref} is not in this snapshot.`)
    }
    await this.manager.accessibilityPerform(this.sessionId, 'press', addressing.generation, uid)
  }

  private async send(input: IosSimulatorInput): Promise<void> {
    const result = await this.manager.input(this.sessionId, input)
    if (!result.ok) {
      throw new DeviceAgentError('UNSUPPORTED', result.error ?? 'The device rejected the input.')
    }
  }

  /**
   * Play a synthesized gesture in real time.
   *
   * The waits are the gesture: the guest reads velocity and hold duration off the
   * gaps between contact updates, so sending the series back to back would turn
   * every swipe into a teleport and every long press into a tap.
   */
  private async runGesture(steps: readonly TouchStep[], signal?: AbortSignal): Promise<void> {
    try {
      for (const step of steps) {
        throwIfDeviceOperationAborted(signal)
        await this.send(toIosSimulatorInput(step))
        if (step.delayMs > 0) await waitForDeviceDelay(step.delayMs, signal)
      }
    } catch (error) {
      // An interrupted long press or swipe can otherwise leave a finger held down
      // until the helper's own watchdog fires.
      await this.send({ type: 'touch.cancel' }).catch(() => {})
      throw error
    }
  }

  /** Wall-clock a gesture will take, so callers can budget a timeout around it. */
  static gestureBudgetMs(steps: readonly TouchStep[]): number {
    return gestureDurationMs(steps)
  }
}
