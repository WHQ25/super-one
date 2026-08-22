/**
 * A device as the PANEL sees it — the picture, and the hands on it.
 *
 * The third seam, alongside `TouchDeviceBackend` (the agent driving a device) and
 * `DevicePlatformPort` (finding one and being handed it). This one covers what a human
 * does: watch a live stream and touch it.
 *
 * Separate from the other two because the audiences differ. The agent takes one
 * deliberate action and waits for the screen to settle; a person produces a hundred
 * contact updates a second and expects frames back immediately. Folding both into one
 * interface would make every implementation carry the other's constraints.
 */

import type {
  DeviceCapture,
  DeviceFrame,
  DeviceInput,
  DeviceInputResult,
  DevicePlatform,
  DeviceSessionState,
  DeviceStreamOptions,
} from '@superone/shared/device'

export type { DeviceCapture }

export interface DeviceSurface {
  readonly platform: DevicePlatform

  /**
   * Whether this session's device is one of ours. THE ROUTING JUDGEMENT, and it is
   * synchronous by contract.
   *
   * Every call the panel makes has to be routed, and one of them is `input` — which
   * a dragging finger produces up to 125 times a second. So this may only read what
   * the host already knows: which session bound which device, which both managers
   * hold in memory.
   *
   * `sessionState` is the answer that looks equally correct and is not: on iOS it
   * spawns `simctl list devices --json`, a quarter of a second of talking to
   * CoreSimulatorService. Routing through it put one of those in front of every
   * touch sample and made the simulator unusable while looking, from the outside,
   * exactly like a rendering problem.
   */
  owns(sessionId: string): boolean

  sessionState(sessionId: string): Promise<DeviceSessionState>

  /** Point a session at a device without starting anything. */
  bind(sessionId: string, deviceId: string): Promise<DeviceSessionState>
  /** Point a session at a device and get it running. */
  boot(sessionId: string, deviceId: string): Promise<DeviceSessionState>
  /** Let go, leaving the device running for whoever wants it next. */
  detach(sessionId: string): Promise<DeviceSessionState>
  /** Let go AND stop the device. */
  shutdown(sessionId: string): Promise<DeviceSessionState>
  /** Drop everything this session held, on its way out. */
  release(sessionId: string): Promise<void>

  input(sessionId: string, input: DeviceInput): Promise<DeviceInputResult>
  screenshot(sessionId: string): Promise<DeviceCapture>
  startRecording(sessionId: string): Promise<DeviceCapture>
  stopRecording(sessionId: string): Promise<DeviceCapture | null>
  isRecording(sessionId: string): boolean

  /**
   * Live frames. Returns an unsubscribe.
   *
   * `options` is advisory: the simulator settles scale and frame rate when the
   * stream starts, so it honours them; scrcpy fixes its own when the video socket
   * opens, so Android ignores them rather than pretending otherwise.
   */
  subscribe(
    sessionId: string,
    listener: (frame: DeviceFrame) => void,
    options?: DeviceStreamOptions,
  ): () => void

  /**
   * State changes the panel did not ask for.
   *
   * Orientation and the keyboard switch live in the main process, and an agent driving
   * the device changes them behind the panel's back.
   */
  onSessionState(listener: (state: DeviceSessionState) => void): () => void
}

/**
 * Which surface owns a session.
 *
 * Resolved per call rather than remembered: a session can be handed from one platform
 * to another, and a cached answer would keep sending touches to the device it used
 * to hold. Resolving per call is only affordable because `owns` is cheap — see it.
 */
export interface DeviceSurfaceRegistry {
  surfaces(): DeviceSurface[]
  forSession(sessionId: string): DeviceSurface
}
