import { DEVICE_CAPABILITIES, DEVICE_ROTATION_DEGREES, type DeviceOrientation, type DeviceProvider } from '@superone/shared/device'
import type { IosSimulatorFoldState } from '@superone/shared/ios-simulator'

/**
 * How far the picture is turned on screen, clockwise.
 *
 * A simulator draws its rotated UI into a framebuffer that never changes shape, so the
 * host turns the device by its orientation. An unfolded Duo's lit panel is mounted
 * sideways under a device held upright, which is one more rigid turn of the same
 * object. Android re-shapes its framebuffer instead, so its picture arrives upright.
 */
export function deviceLayoutRotation(
  provider: DeviceProvider,
  orientation: DeviceOrientation,
  fold: Pick<IosSimulatorFoldState, 'panelRotation'> | null | undefined,
): number {
  if (!DEVICE_CAPABILITIES[provider].rigidRotation) return 0
  return (DEVICE_ROTATION_DEGREES[orientation] + (fold?.panelRotation ?? 0)) % 360
}
