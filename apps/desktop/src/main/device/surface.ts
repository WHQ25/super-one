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
  DeviceProvider,
  DeviceSessionState,
  DeviceStreamOptions,
} from '@superone/shared/device'

export type { DeviceCapture }

export interface DeviceSurface {
  readonly provider: DeviceProvider

  /**
   * Every device this session holds here. The only session-shaped question left.
   *
   * A session may hold several devices at once — a client build and a merchant build,
   * an iPhone and an Android — so everything below takes the DEVICE, and this is what
   * answers "which ones are mine" for release and for the agent's default target.
   */
  devicesOf(sessionId: string): string[]

  state(deviceId: string): Promise<DeviceSessionState>

  /** Point a session at a device without starting anything. */
  bind(sessionId: string, deviceId: string): Promise<DeviceSessionState>
  /** Point a session at a device and get it running. */
  boot(sessionId: string, deviceId: string): Promise<DeviceSessionState>
  /** Let go, leaving the device running for whoever wants it next. */
  detach(deviceId: string): Promise<DeviceSessionState>
  /** Let go AND stop the device. */
  shutdown(deviceId: string): Promise<DeviceSessionState>
  /** Drop every device this session held, on its way out. */
  releaseSession(sessionId: string): Promise<void>

  input(deviceId: string, input: DeviceInput): Promise<DeviceInputResult>
  screenshot(deviceId: string): Promise<DeviceCapture>
  startRecording(deviceId: string): Promise<DeviceCapture>
  stopRecording(deviceId: string): Promise<DeviceCapture | null>
  isRecording(deviceId: string): boolean

  /**
   * Live frames. Returns an unsubscribe.
   *
   * `options` is advisory: the simulator settles scale and frame rate when the
   * stream starts, so it honours them; scrcpy fixes its own when the video socket
   * opens, so Android ignores them rather than pretending otherwise. See
   * `DEVICE_CAPABILITIES.previewQuality`.
   */
  subscribe(
    deviceId: string,
    listener: (frame: DeviceFrame) => void,
    options?: DeviceStreamOptions,
  ): () => void

  /**
   * State changes the panel did not ask for.
   *
   * Orientation and the keyboard switch live in the main process, and an agent driving
   * the device changes them behind the panel's back.
   */
  onState(listener: (state: DeviceSessionState) => void): () => void
}

/**
 * Which surface speaks to a device.
 *
 * A pure function of the id: `parseDeviceId` reads the provider off the prefix, and
 * the prefix is what the surface registers under. There is no state to consult and
 * nothing to keep in step — which is what makes routing free enough to sit in front
 * of every touch sample.
 */
export interface DeviceSurfaceRegistry {
  surfaces(): DeviceSurface[]
  forDevice(deviceId: string): DeviceSurface
}
