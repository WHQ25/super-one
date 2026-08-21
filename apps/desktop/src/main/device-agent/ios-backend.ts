import type { DeviceOrientation } from '@superone/shared/device-agent'
import type { IosSimulatorInput } from '@superone/shared/ios-simulator'
import {
  fingerprintTree,
  normalizeAccessibilityTree,
  type NormalizedAccessibilityTree,
} from '../ios-simulator/a11y-tree'
import {
  gestureDurationMs,
  synthesizeDoubleTap,
  synthesizeLongPress,
  synthesizePinch,
  synthesizeSwipe,
  type GestureStep,
} from '../ios-simulator/gesture-synth'
import { settle } from '../ios-simulator/settle'
import type { IosSimulatorManager } from '../ios-simulator/ios-simulator-manager'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  waitForDeviceDelay,
  type DeviceImage,
  type DeviceObservation,
  type ObserveOptions,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

/**
 * The iOS Simulator as a touch device.
 *
 * Bound to the same session the Activity panel uses, deliberately: the agent drives
 * the device the user is already watching, so a run is observable as it happens
 * rather than reconstructed from a log afterwards.
 */
export class IosSimulatorBackend implements TouchDeviceBackend {
  /** Refs are positional per snapshot; this maps them onto helper uids. */
  private tree: NormalizedAccessibilityTree | null = null
  private generation = 0

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
        'No simulator is ready for this session. Boot one from the Activity panel first.',
      )
    }
    this.deviceLabel = state.device.name
    const orientation = state.orientation as DeviceOrientation
    const screen = { width: state.pixelWidth ?? 0, height: state.pixelHeight ?? 0 }

    const sample = async () => {
      throwIfDeviceOperationAborted(options.signal)
      const dump = await this.manager.accessibilityDump(this.sessionId, {
        ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}),
      })
      throwIfDeviceOperationAborted(options.signal)
      return { dump, tree: normalizeAccessibilityTree(dump, orientation) }
    }

    // Settling is done here rather than in the tool so that every path into the
    // backend gets it — including the polling inside device_wait_for, which would
    // otherwise happily report a control it saw mid-transition.
    const result = options.immediate
      ? { value: await sample(), settled: false }
      : await settle(sample, ({ tree }) => fingerprintTree(tree.root), {
          timeoutMs: options.settleTimeoutMs ?? 2500,
          intervalMs: Math.min(150, Math.max(options.settleTimeoutMs ?? 2500, 1)),
          ...(options.signal ? { signal: options.signal } : {}),
        })

    this.tree = result.value.tree
    this.generation = result.value.dump.generation
    return {
      root: result.value.tree.root,
      orientation,
      screen,
      settled: result.settled,
      ...(result.value.dump.complete ? {} : { truncated: true }),
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

  async perform(action: ResolvedAction, signal?: AbortSignal): Promise<void> {
    throwIfDeviceOperationAborted(signal)
    switch (action.kind) {
      case 'press': return this.press(action.ref)
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

  private async press(ref: string): Promise<void> {
    const uid = this.tree?.refs.get(ref)
    if (uid === undefined) {
      throw new DeviceAgentError('UNKNOWN_REF', `${ref} is not in the current snapshot.`)
    }
    await this.manager.accessibilityPerform(this.sessionId, 'press', this.generation, uid)
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
  private async runGesture(steps: readonly GestureStep[], signal?: AbortSignal): Promise<void> {
    try {
      for (const step of steps) {
        throwIfDeviceOperationAborted(signal)
        await this.send(step.input)
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
  static gestureBudgetMs(steps: readonly GestureStep[]): number {
    return gestureDurationMs(steps)
  }
}
