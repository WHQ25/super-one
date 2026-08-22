/**
 * A touch device's identity, independent of which platform provides it.
 *
 * This is the currency the device catalog, the control grant, and eventually the
 * device picker all trade in. `@superone/shared/device-agent` is the other half —
 * what a device's SCREEN looks like; this is what a DEVICE is.
 *
 * Classification (`kind`, `model`, `versionRank`) is computed by the platform that
 * owns the device and carried here as data, rather than being re-derived by whoever
 * groups them. That is what lets one set of tier logic serve both platforms without
 * either having to speak the other's vocabulary: iOS says `iphone`, Android says
 * `phone`, and the grouping code never has to know that those are the same idea.
 */

import { isDeviceLandscape, type DeviceOrientation } from './device-agent'

export type DevicePlatform = 'ios' | 'android'

export interface DeviceDescriptor {
  /**
   * Stable handle, platform-prefixed: `ios:<udid>`, `android:<serial>`.
   *
   * The prefix is load-bearing rather than decorative — it is what lets a single
   * string route to the right backend, so no signature below this point needs to
   * carry a platform alongside the id it already has.
   */
  id: string
  platform: DevicePlatform
  /** As the user sees it. Editable on both platforms, so never parse it. */
  name: string
  /**
   * Family slug, in the platform's OWN vocabulary — `iphone`/`ipad` on iOS,
   * `phone`/`tablet` on Android.
   *
   * Deliberately not normalized into a shared enum. An iPad is not a "tablet" to
   * anyone who works with them, and flattening the two would make the catalog read
   * wrong to the person who has to recognize their own device in it.
   */
  kind: string
  /** Display name for `kind`, e.g. "iPhone". */
  kindName: string
  /**
   * Where this family sorts among its platform's own families. Lower is first.
   *
   * Carried rather than derived because the order is an editorial choice only the
   * platform can make — iPhone before iPad before Apple Watch is not alphabetical,
   * not by count, and not by anything the grouping code could reconstruct.
   */
  kindRank: number
  /**
   * The device it IS, independent of what it was named or which OS version it runs.
   *
   * The axis a platform's catalog collapses along. On iOS one "iPhone 17 Pro Max"
   * stands for the ten runtimes it is installed for; on Android an AVD is usually
   * its own model, so the collapse is a no-op and the tier is simply shallower.
   */
  model: string
  /** Platform version as the user sees it, e.g. "iOS 26.4", "Android 16". */
  platformVersion: string
  /**
   * Sort key among devices sharing a `model`. Higher is newer.
   *
   * A number rather than the version string because `iOS-26-4` and `iOS-17-10` have
   * to order by version, not lexically — otherwise naming a bare model resolves to a
   * four-year-old runtime that merely sorts late.
   */
  versionRank: number
  /** Already running — taking control attaches instead of spending a cold boot. */
  running: boolean
  /** Bootable at all. An uninstalled runtime, or a device that is offline. */
  available: boolean
  /** The chat session currently driving it, if any. */
  boundSessionId?: string
}

/** Split `ios:UDID` back into its parts. Null when the handle is not prefixed. */
export function parseDeviceId(
  id: string,
): { platform: DevicePlatform; native: string } | null {
  const separator = id.indexOf(':')
  if (separator <= 0) return null
  const platform = id.slice(0, separator)
  const native = id.slice(separator + 1)
  if (!native) return null
  if (platform !== 'ios' && platform !== 'android') return null
  return { platform, native }
}

export function formatDeviceId(platform: DevicePlatform, native: string): string {
  return `${platform}:${native}`
}

/** Human label for a platform, for prompts and summaries. */
export const DEVICE_PLATFORM_NAMES: Record<DevicePlatform, string> = {
  ios: 'iOS Simulator',
  android: 'Android',
}

/**
 * One frame of a device's screen, on its way to a canvas.
 *
 * Already neutral in everything but its old name: both platforms deliver H.264 with
 * a separate codec-config packet, so the simulator's framebuffer stream and scrcpy's
 * video socket produce the same shape and the renderer decodes them with one path.
 */
export interface DeviceFrame {
  sessionId: string
  sequence: number
  timestampMs: number
  timestampUs?: number
  mimeType: 'image/png' | 'video/avc'
  keyframe: boolean
  /** SPS/PPS rather than a picture. A decoder needs it before its first frame. */
  codecConfig: boolean
  codec?: string
  codedWidth?: number
  codedHeight?: number
  data: Uint8Array
}

/**
 * How far clockwise the device is lying.
 *
 * The landscape pair is the trap, and it is Apple's naming that makes it one:
 * `landscape-left` says where the HOME BUTTON ends up, not which way the device
 * turned, so it is a quarter turn anti-clockwise — 270deg — and `landscape-right`
 * is its mirror. Reading the names as turn directions lands both 180deg out.
 *
 * What this angle MEANS differs by platform, which is what `DEVICE_RIGID_ROTATION`
 * below is for. Read that before using this to lay anything out.
 */
export const DEVICE_ROTATION_DEGREES: Record<DeviceOrientation, number> = {
  'portrait': 0,
  'landscape-right': 90,
  'portrait-upside-down': 180,
  'landscape-left': 270,
}

/** Clockwise order, so stepping forward turns the device to the right. */
export const DEVICE_ORIENTATION_CYCLE = [
  'portrait',
  'landscape-right',
  'portrait-upside-down',
  'landscape-left',
] as const satisfies readonly DeviceOrientation[]

export function stepDeviceOrientation(
  orientation: DeviceOrientation,
  direction: 'left' | 'right',
): DeviceOrientation {
  const cycle = DEVICE_ORIENTATION_CYCLE
  const index = cycle.indexOf(orientation)
  const step = direction === 'right' ? 1 : -1
  return cycle[(index + step + cycle.length) % cycle.length]!
}

/**
 * Whether turning the device leaves its framebuffer the same shape.
 *
 * The single load-bearing difference between the two platforms as far as anything
 * DRAWING a device is concerned, so it is data here rather than a branch at each
 * of the four places that need it.
 *
 * A simulator draws its rotated UI into a surface that never changes shape, exactly
 * like a real panel — so the host turns artwork and picture together as one rigid
 * CSS rotation, and `DEVICE_ROTATION_DEGREES` is literally the angle to apply.
 *
 * Android re-shapes the framebuffer instead: scrcpy re-sends a session packet with
 * the axes swapped (360x800 becomes 800x360), so the picture ARRIVES upright and
 * turning it again would lay it on its side. There the angle is a reading only —
 * whatever draws it must RESIZE, never rotate. `pixelWidth`/`pixelHeight` on
 * `DeviceSessionState` already carry the swapped values.
 */
export const DEVICE_RIGID_ROTATION: Record<DevicePlatform, boolean> = {
  ios: true,
  android: false,
}

/**
 * Whether the platform can record its screen to a file.
 *
 * `simctl io recordVideo` does it directly. Android's `adb shell screenrecord` could,
 * but it needs a lifecycle of its own — a device-side process, a three-minute cap to
 * work around, and a pull when it stops — none of which is shared with the
 * simulator's path. Declared here so the button is DISABLED rather than offered and
 * then refused.
 */
export const DEVICE_SUPPORTS_RECORDING: Record<DevicePlatform, boolean> = {
  ios: true,
  android: false,
}

/**
 * How many simultaneous contacts a host pointer may synthesise.
 *
 * Two, on both platforms, because two is what a mouse can express: one finger, or
 * two mirrored about the centre with the option key held. The transports below
 * would take more (scrcpy allows ten), but nothing upstream can produce them.
 */
export const DEVICE_MAX_TOUCH_CONTACTS = 2 as const

export type DeviceTouchPhase = 'began' | 'moved' | 'ended' | 'cancelled'

export interface DeviceTouchContact {
  id: number
  /** Framebuffer ratios, so a contact survives rotation and display scale. */
  xRatio: number
  yRatio: number
  phase: DeviceTouchPhase
}

/**
 * What a person's hands and keyboard send to a device.
 *
 * Distinct from the agent's `ResolvedAction`: this is the raw stream a pointer
 * produces, arriving many times a second, while an action is one deliberate
 * instruction. Each backend translates these into its own transport — HID messages for
 * the simulator helper, `INJECT_*` for scrcpy.
 */
export type DeviceInput =
  | { type: 'touch.update'; contacts: DeviceTouchContact[] }
  | { type: 'touch.cancel' }
  | { type: 'tap'; xRatio: number; yRatio: number }
  | { type: 'text'; text: string }
  | { type: 'button'; button: string }
  | { type: 'rotate'; orientation: DeviceOrientation }
  /**
   * Plug the simulated hardware keyboard in or out.
   *
   * iOS only, and backwards from the obvious reading: iOS shows its ON-SCREEN keyboard
   * exactly when a field has focus and NO hardware keyboard is attached. Android has
   * no such switch and refuses this.
   */
  | { type: 'keyboard'; connected: boolean }

export interface DeviceInputResult {
  ok: boolean
  skippedCharacters?: number
  error?: string
}

/** What a chat session is looking at, whichever platform provides it. */
export interface DeviceSessionState {
  sessionId: string
  device: DeviceDescriptor | null
  phase: 'idle' | 'booting' | 'ready' | 'stopping' | 'error'
  /** Whether input is accepted. False while booting, or on a device that refused HID. */
  interactive: boolean
  /**
   * Which way up the device is lying.
   *
   * A reading, not a request: an app pinned upright never turns, so this reports what
   * was observed to land rather than what was asked for.
   */
  orientation: DeviceOrientation
  /** The device's own framebuffer size. Absent until a stream has attached. */
  pixelWidth?: number
  pixelHeight?: number
  error?: string
  /**
   * Platform-specific state, present only for the platform in question.
   *
   * A deliberate escape hatch rather than a flattened superset: the hardware-keyboard
   * switch is meaningless on Android and the AVD name is meaningless on iOS, and a
   * shared shape carrying both would make every reader check which half is real.
   */
  ios?: {
    previewMode: string
    hardwareKeyboardConnected: boolean
    hardwareKeyboardAvailable: boolean
  }
}

/** Which hardware buttons a platform actually has. */
export const DEVICE_BUTTONS_IOS = ['home', 'lock', 'side', 'volume-up', 'volume-down'] as const
export const DEVICE_BUTTONS_ANDROID = [
  'home', 'back', 'app-switch', 'lock', 'side', 'volume-up', 'volume-down',
] as const

/** A file the panel pulled off the device, parked in this session's capture directory. */
export interface DeviceCapture {
  kind: 'screenshot' | 'recording'
  path: string
  /** Carried separately so a toast can name the file without splitting a path. */
  fileName: string
}

/**
 * What the panel would like of the frame stream, where the platform can honour it.
 *
 * Optional and advisory throughout. The simulator settles both in `stream.start`,
 * so changing either renegotiates; scrcpy's are fixed when its video socket opens
 * and Android ignores this entirely rather than pretending to accept it.
 */
export interface DeviceStreamOptions {
  /** Platform's own preview-path hint. Meaningless where there is only one path. */
  mode?: string
  quality?: { scale: number; maxFrameRate: number }
}

export { isDeviceLandscape }
export type { DeviceOrientation }
