/**
 * A mirrored iPhone as a touch device the agent can drive.
 *
 * Satisfies the same `TouchDeviceBackend` as the other two, and the layer above cannot
 * tell which it is holding — but this one refuses more than it accepts, and the
 * refusals are the interesting part.
 *
 * The root cause of every one of them is that the phone arrives as a video stream
 * driven by a synthetic mouse. That gives:
 *
 * - No element tree. `observe` returns OCR nodes, so `press` has nothing to press.
 * - One pointer. A pinch needs two, so there is no pinch.
 * - Whole gestures only. The helper's vocabulary is click and drag-along-a-path; there
 *   is no press-and-hold, so no long press.
 * - No rotation, no hardware keyboard, no volume or lock keys.
 *
 * Each of those is reported as UNSUPPORTED rather than approximated. An approximated
 * long press that is really a click looks like the agent pressed the right thing and
 * got the wrong result, which costs far more turns than a clear refusal.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { captureFileName } from '../device/capture-path'
import { settle } from '../device/settle'
import type { MirrorDeviceManager } from '../device/ios-mirror/mirror-device-manager'
import { mirrorTextToTree } from '../device/ios-mirror/mirror-tree'
import {
  dragMirror,
  pressMirrorKey,
  recognizeMirrorText,
  tapMirror,
  typeMirrorText,
  type MirrorSnapshot,
} from '../device/ios-mirror/mirror-helper'
import {
  DeviceAgentError,
  throwIfDeviceOperationAborted,
  type DeviceImage,
  type DeviceObservation,
  type ObserveOptions,
  type PerformContext,
  type ResolvedAction,
  type TouchDeviceBackend,
} from './types'

/**
 * Gap between settle samples.
 *
 * Generous next to the simulator's 150ms because each sample is a whole
 * ScreenCaptureKit round trip plus a PNG encode. Sampling faster would not see the
 * screen sooner, only queue captures behind each other.
 */
const SETTLE_INTERVAL_MS = 200

/**
 * How long the picture gets to stop moving.
 *
 * Shorter than the simulator's, on purpose. Settling here compares whole PNGs, and if
 * that ever proves non-deterministic for a still screen the loop can never agree — so
 * the failure mode is "waits the full budget, then reports unsettled", and the budget
 * is what bounds the damage. It is not a hang either way: `settle` reports a timeout
 * rather than throwing.
 */
const SETTLE_TIMEOUT_MS = 1_500

/** Straight-line interpolation for a swipe. iOS reads speed out of the spacing. */
const SWIPE_STEPS = 12

/** The only "hardware" a mirroring window forwards — its own menu shortcuts. */
const BUTTON_KEYS: Partial<Record<string, string>> = {
  home: 'cmd+1',
  'app-switch': 'cmd+2',
}

export class MirrorBackend implements TouchDeviceBackend {
  readonly label = 'iPhone'

  constructor(
    private readonly manager: MirrorDeviceManager,
    private readonly deviceId: string,
    private readonly captureRoot: string,
  ) {}

  /**
   * Read the screen: one capture, settled, then recognized.
   *
   * The order matters. OCR runs ONCE, on the frame that stopped moving, exactly as
   * Android reads its tree once — recognition is the expensive half and running it per
   * sample would make every observation cost seconds for nothing.
   */
  async observe(options: ObserveOptions = {}): Promise<DeviceObservation> {
    throwIfDeviceOperationAborted(options.signal)

    const sample = async () => {
      throwIfDeviceOperationAborted(options.signal)
      const snapshot = await this.manager.capture()
      return { snapshot, hash: createHash('sha256').update(snapshot.png).digest('hex') }
    }

    const result = options.immediate
      ? { value: await sample(), settled: false }
      : await settle(sample, ({ hash }) => hash, {
        timeoutMs: options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
        intervalMs: SETTLE_INTERVAL_MS,
        ...(options.signal ? { signal: options.signal } : {}),
      })

    throwIfDeviceOperationAborted(options.signal)
    const { snapshot, hash } = result.value
    const texts = await recognizeMirrorText(snapshot)
    throwIfDeviceOperationAborted(options.signal)

    return {
      root: mirrorTextToTree(
        texts,
        snapshot,
        ...(options.maxNodes ? [options.maxNodes] as const : []),
      ),
      // Always upright: macOS reshapes the window when the phone turns, so what was
      // captured is already the right way up.
      orientation: 'portrait',
      screen: { width: snapshot.width, height: snapshot.height },
      settled: result.settled,
      frameHash: hash,
    }
  }

  async capture(): Promise<DeviceImage> {
    const snapshot = await this.manager.capture()
    const fileName = captureFileName(this.deviceId, 'png', new Date())
    const path = join(this.captureRoot, fileName)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, snapshot.png)
    return { path, width: snapshot.width, height: snapshot.height }
  }

  async perform(action: ResolvedAction, context: PerformContext): Promise<void> {
    throwIfDeviceOperationAborted(context.signal)
    // The capture the action was aimed at, not whatever is on screen now. The helper
    // re-checks the window's live geometry against it and refuses if it has moved,
    // which turns "the user dragged the window mid-turn" into a clear failure instead
    // of a tap at an arbitrary place.
    const snapshot = await this.manager.snapshotForInput()

    switch (action.kind) {
      case 'tap':
        await tapMirror(snapshot, ...this.point(snapshot, action.x, action.y))
        return
      case 'doubleTap':
        await tapMirror(snapshot, ...this.point(snapshot, action.x, action.y), 2)
        return
      case 'swipe':
        await dragMirror(snapshot, this.line(
          snapshot,
          { x: action.fromX, y: action.fromY },
          { x: action.toX, y: action.toY },
        ))
        return
      case 'type':
        await typeMirrorText(snapshot, action.text)
        return
      case 'key': {
        const key = BUTTON_KEYS[action.button]
        if (!key) {
          throw new DeviceAgentError(
            'UNSUPPORTED',
            `A mirrored iPhone has no ${action.button} button. Mirroring forwards only Home and the app switcher.`,
          )
        }
        await pressMirrorKey(snapshot, key)
        return
      }
      case 'longPress':
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'A mirrored iPhone cannot be long-pressed: the mirroring window is driven by whole '
          + 'mouse gestures, with no press-and-hold among them.',
        )
      case 'pinch':
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'A mirrored iPhone cannot be pinched: it is driven by a single synthetic pointer.',
        )
      case 'press':
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'A mirrored iPhone has no accessibility tree, so there is no element to press. '
          + 'Every node in the snapshot was read from the pixels — tap it by position instead.',
        )
      case 'rotate':
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'A mirrored iPhone turns only when its owner turns the phone.',
        )
      case 'keyboard':
        throw new DeviceAgentError(
          'UNSUPPORTED',
          'A real iPhone has no simulated hardware keyboard to connect or disconnect.',
        )
    }
  }

  /** Ratios to capture pixels, which is the space the helper resolves points in. */
  private point(snapshot: MirrorSnapshot, x: number, y: number): [number, number] {
    return [x * snapshot.width, y * snapshot.height]
  }

  /**
   * A swipe as a densified path.
   *
   * Two points would reach the same place, but iOS reads velocity out of the spacing
   * between samples — a two-point drag arrives as a slow pull and scrolls a list by a
   * few pixels where the agent meant to fling it.
   */
  private line(
    snapshot: MirrorSnapshot,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Array<{ x: number; y: number }> {
    return Array.from({ length: SWIPE_STEPS + 1 }, (_unused, step) => {
      const progress = step / SWIPE_STEPS
      const [x, y] = this.point(
        snapshot,
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
      )
      return { x, y }
    })
  }
}
