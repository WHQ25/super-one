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
  DeviceState,
  DeviceStreamOptions,
} from '@superone/shared/device'

export type { DeviceCapture }

export interface DeviceSurface {
  readonly provider: DeviceProvider

  state(deviceId: string): Promise<DeviceState>

  /** Point a session at a device without starting anything. */
  bind(sessionId: string, deviceId: string): Promise<DeviceState>
  /** Point a session at a device and get it running. */
  boot(sessionId: string, deviceId: string): Promise<DeviceState>
  /** Let go, leaving the device running for whoever wants it next. */
  detach(deviceId: string): Promise<DeviceState>
  /** Let go AND stop the device. */
  shutdown(deviceId: string): Promise<DeviceState>
  /**
   * Put the device back the way it was found, on the way out of the tab showing it.
   *
   * Between `detach` and `shutdown`, and neither: a device SuperOne started is
   * stopped, one that was already running when we found it is left running. Closing
   * a panel should not leave a simulator burning CPU that nobody asked for, and
   * should not take down the emulator the user had open before we arrived.
   *
   * Per device rather than per session: a session may have several tabs open, and
   * closing one of them says nothing about the others.
   */
  release(deviceId: string): Promise<void>

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
  onState(listener: (state: DeviceState) => void): () => void
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
