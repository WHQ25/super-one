/** Device settings that live outside the screen/input transaction. */
export type DeviceAppearance = 'light' | 'dark'
/** Every category accepted by `simctl ui <device> content_size`, in slider order. */
export const IOS_CONTENT_SIZES = [
  'extra-small', 'small', 'medium', 'large', 'extra-large', 'extra-extra-large',
  'extra-extra-extra-large', 'accessibility-medium', 'accessibility-large',
  'accessibility-extra-large', 'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
] as const

/** AOSP Settings font-size stops before and after Android 14's 200% support. */
export const ANDROID_FONT_SCALES = ['0.85', '1', '1.15', '1.3', '1.5', '1.8', '2'] as const

export type DeviceEnvironmentAction =
  | { kind: 'appearance'; value: DeviceAppearance }
  | { kind: 'location'; latitude: number; longitude: number }
  | { kind: 'clear_location' }
  | { kind: 'posture'; id: number }
  | { kind: 'text_size'; value: string }

export interface DevicePostureOption { id: number; label: string }

export interface DeviceEnvironmentState {
  deviceId: string
  appearance: DeviceAppearance | null
  /** Native content-size category on iOS, font-scale factor on Android. */
  textSize: string | null
  textSizeSupported: boolean
  /** Native slider stops for this runtime; a nonstandard current value may also appear. */
  textSizeOptions: string[]
  /** Location cannot be read back reliably from either simulator command interface. */
  locationReadable: false
  canClearLocation: boolean
  postures: DevicePostureOption[]
  /** The emulator console does not report its current posture with the option list. */
  posture: null
}

export interface DeviceEnvironmentResult {
  /** Appearance and text size can be read back; location and posture only confirm command delivery. */
  status: 'verified' | 'applied'
  deviceId: string
  action: DeviceEnvironmentAction
  /** A successful command confirms delivery, not that an app consumed a GPS fix. */
  state: DeviceEnvironmentState
}
