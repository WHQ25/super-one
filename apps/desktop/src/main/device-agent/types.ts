import type {
  DeviceOrientation,
  DeviceUiNode,
} from '@superone/shared/device-agent'

/**
 * What every touch-device backend must provide.
 *
 * Deliberately narrow. Anything that can be expressed in terms of these — gesture
 * synthesis, ref resolution, staleness, outcome judgement — lives above this line
 * and is therefore shared by every backend rather than reimplemented per platform.
 * An Android backend should be able to satisfy this without the layer above
 * learning that it exists.
 */
export interface TouchDeviceBackend {
  /** For summaries and errors, e.g. "iPhone 17 Pro Max". */
  readonly label: string

  /**
   * Read the current screen.
   *
   * The backend owns settling: only it knows what "the picture stopped changing"
   * means for its platform, and doing it here keeps the wait on the same side as
   * the sampling it is waiting on.
   */
  observe(options?: ObserveOptions): Promise<DeviceObservation>

  /** Save a screenshot to disk. Never returns pixels — the agent gets a path. */
  capture(): Promise<DeviceImage>

  /**
   * Apply one already-resolved action against the observation it was aimed at.
   *
   * Refs are resolved to whatever the backend actually addresses (a uid, a native
   * handle) inside the backend, so no identifier from one platform leaks upward.
   * The observation is passed rather than remembered because "the last thing I
   * observed" and "the snapshot the agent quoted" are not the same thing: an
   * observation can succeed and still never reach the state store, and a backend
   * addressing through its own latest read would then press a control the caller
   * never saw. Tying the lookup to the observation makes that divergence
   * unrepresentable.
   */
  perform(action: ResolvedAction, context: PerformContext): Promise<void>
}

export interface PerformContext {
  /** The snapshot this action was resolved against. */
  observation: DeviceObservation
  signal?: AbortSignal
}

export interface ObserveOptions {
  maxNodes?: number
  /** Skip the settle wait. Only for polling loops that settle themselves. */
  immediate?: boolean
  /** Override the backend's normal settle budget, e.g. with a wait_for deadline. */
  settleTimeoutMs?: number
  /**
   * Whether a screen whose tree cannot be read is a failure or a thin observation.
   *
   * `required` (the default) is right when the tree IS the answer — a semantic
   * snapshot has nothing to return without one. `optional` is right everywhere the
   * tree is a bonus: a visual snapshot returns pixels, and the read-back after an
   * action is there to describe what happened, not to decide whether it happened.
   *
   * The distinction is not hypothetical on Android. `uiautomator dump` waits for the
   * UI to go idle, and a screen playing video never does — so a whole class of screen
   * has pixels and no tree, permanently. Treating that as a device failure is what
   * made an action that had already run report as an error.
   */
  tree?: 'required' | 'optional'
  signal?: AbortSignal
}

export interface DeviceObservation {
  root: DeviceUiNode
  orientation: DeviceOrientation
  /** Framebuffer size in pixels. */
  screen: { width: number; height: number }
  settled: boolean
  truncated?: boolean
  /**
   * The tree could not be read, and the caller said that was survivable.
   *
   * `root` is then a bare stand-in for the screen with no children — enough to carry
   * geometry, and deliberately not enough to resolve a ref against. Set only when
   * `ObserveOptions.tree` was `optional`; otherwise the read throws instead.
   */
  treeUnavailable?: true
  /**
   * Perceptual fingerprint of the pixels behind this observation, when they could be
   * read. Kept so judging whether an action changed anything can consult the screen
   * as well as the tree -- the tree misses a crossfade, and on an app with no tree it
   * is the only evidence there is.
   */
  frameHash?: string
}

export interface DeviceImage {
  path: string
  width: number
  height: number
}

/**
 * An action with its target already turned into concrete coordinates or a ref.
 *
 * Coordinates are framebuffer ratios, matching `DeviceUiNode.bounds`, so the tool
 * layer can aim at a node's centre without knowing the device's pixel size.
 */
export type ResolvedAction =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'doubleTap'; x: number; y: number }
  | { kind: 'longPress'; x: number; y: number; durationMs?: number }
  | { kind: 'swipe'; fromX: number; fromY: number; toX: number; toY: number; durationMs?: number }
  | { kind: 'pinch'; x: number; y: number; scale: number; durationMs?: number }
  /**
   * Drive the control through accessibility instead of touch.
   *
   * Immune to animation, rotation and display scale because it addresses the
   * element rather than a place on the glass — but only available for controls the
   * app actually labelled.
   */
  | { kind: 'press'; ref: string }
  | { kind: 'type'; text: string }
  | { kind: 'key'; button: DeviceHardwareButton }
  | { kind: 'rotate'; orientation: DeviceOrientation }
  /**
   * Plug the simulated hardware keyboard in or out.
   *
   * Backwards from the obvious reading: iOS shows its ON-SCREEN keyboard exactly
   * when a field has focus and NO hardware keyboard is attached, so "make the
   * software keyboard appear" means disconnecting this one.
   */
  | { kind: 'keyboard'; connected: boolean }

/**
 * Buttons an agent can press.
 *
 * The union is the SUPERSET across platforms, not the intersection. `back` and
 * `app-switch` exist only on Android, and leaving them out to keep the type
 * symmetrical would cost an agent the only reliable way to leave a screen there — a
 * capability gap is better reported through `UNSUPPORTED` than designed away.
 */
export type DeviceHardwareButton =
  | 'home'
  | 'lock'
  | 'side'
  | 'volume-up'
  | 'volume-down'
  /** Android only. The system back gesture/button. */
  | 'back'
  /** Android only. The recents / overview switcher. */
  | 'app-switch'

export class DeviceAgentError extends Error {
  constructor(readonly code: DeviceAgentErrorCode, message: string) {
    super(message)
    this.name = 'DeviceAgentError'
  }
}

export type DeviceAgentErrorCode =
  | 'ABORTED'
  /**
   * The user was asked and said no. Its own code rather than a NO_DEVICE variant so
   * the transcript can show it as a decision the user made instead of as a fault,
   * which is the difference between a row the user recognizes and one that looks
   * like the app broke.
   */
  | 'DECLINED'
  | 'NO_DEVICE'
  | 'STALE_STATE'
  | 'UNKNOWN_REF'
  | 'UNSUPPORTED'
  | 'INVALID_ACTION'

export function throwIfDeviceOperationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DeviceAgentError('ABORTED', 'The device operation was cancelled.')
  }
}

export function waitForDeviceDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfDeviceOperationAborted(signal)
  if (!signal) {
    return new Promise<void>((resolve) => { setTimeout(resolve, ms) })
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DeviceAgentError('ABORTED', 'The device operation was cancelled.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
