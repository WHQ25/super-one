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

/**
 * How we REACH a device. The `deviceId` prefix, and the key every registry uses.
 *
 * Deliberately not the same axis as `DevicePlatform`, which says what a device RUNS.
 * Today the two happen to correspond one-to-one, which is exactly why they were a
 * single field until now — and why the first device that breaks the correspondence
 * would have broken everything keyed on it.
 *
 * A mirrored physical iPhone is that device: iOS by platform, and nothing like a
 * simulator by provider. It has no framebuffer to attach to, no HID channel, and its
 * window does not turn when the phone does. Every one of those facts belongs to the
 * PROVIDER, so this is what the routing, the capability table, and the id prefix all
 * key on.
 */
export type DeviceProvider = 'ios-sim' | 'android' | 'ios-mirror'

export const DEVICE_PROVIDERS = ['ios-sim', 'android', 'ios-mirror'] as const

/**
 * What a provider's devices run. Many providers may map onto one platform.
 *
 * The direction is load-bearing: platform is derivable from provider, never the
 * other way round. Anything that branches on platform to decide BEHAVIOUR is asking
 * the wrong question — see `DEVICE_CAPABILITIES`.
 */
export const DEVICE_PROVIDER_PLATFORM: Record<DeviceProvider, DevicePlatform> = {
  'ios-sim': 'ios',
  // The pair that proves platform and provider are different axes. A mirrored iPhone
  // runs iOS and is nothing like a simulator to reach — see `DEVICE_CAPABILITIES`.
  'ios-mirror': 'ios',
  'android': 'android',
}

/**
 * What a provider can actually do, so the UI disables rather than offers-and-refuses.
 *
 * Keyed by provider rather than platform because these are properties of the way we
 * reach a device, not of the OS it runs. Rotation is the clearest case: a simulator
 * redraws into a fixed-shape surface, scrcpy re-shapes the framebuffer, and a
 * mirrored phone's window does not rotate at all — three answers, two of them iOS.
 */
export interface DeviceCapabilities {
  /**
   * Whether turning the device leaves its framebuffer the same shape.
   *
   * True means the picture ARRIVES un-rotated and the host turns artwork and picture
   * together as one rigid CSS rotation, so `DEVICE_ROTATION_DEGREES` is literally the
   * angle to apply. False means the framebuffer itself is re-shaped — scrcpy re-sends
   * a session packet with the axes swapped, 360x800 becoming 800x360 — so the picture
   * already arrives upright and whatever draws it must RESIZE, never rotate.
   */
  rigidRotation: boolean
  /**
   * Whether the screen can be recorded to a file.
   *
   * Simulator video comes from `simctl io recordVideo`; Android uses the platform
   * `screenrecord` command and pulls the finalized MP4 back through adb.
   */
  recording: boolean
  /**
   * Whether the preview stream's scale and frame rate can be negotiated.
   *
   * The simulator's helper settles both when the stream starts and honours what it is
   * asked for. scrcpy fixes its own when its video socket opens, and a mirrored phone
   * hands over whatever its window happens to be.
   */
  previewQuality: boolean
  /**
   * Whether the simulated hardware keyboard can be plugged and unplugged.
   *
   * A CoreSimulator setting with no equivalent anywhere else — a real phone's
   * on-screen keyboard is not something the host gets a say in.
   */
  hardwareKeyboard: boolean
  /**
   * Whether the HOST can turn the device at all.
   *
   * Separate from `rigidRotation`, which only describes what happens to the picture
   * once it turns. `simctl` and scrcpy both take a rotate command; a mirrored iPhone
   * turns when its owner physically turns it and there is no API to ask. False means
   * the rotate controls are not merely inert, they should not be drawn.
   */
  rotation: boolean
  /**
   * Whether the device yields a real accessibility tree.
   *
   * True for a simulator (AXPTranslator) and for Android (`uiautomator dump`), and
   * false for a mirrored iPhone, where the phone is a video stream and accessibility
   * genuinely cannot see into it — the agent reads the screen with OCR instead.
   *
   * Carried as a capability rather than discovered as an empty tree because the two
   * look identical at the call site and mean opposite things: "this screen has no
   * controls" versus "this provider can never tell you what the controls are".
   */
  semanticTree: boolean
}

export const DEVICE_CAPABILITIES: Record<DeviceProvider, DeviceCapabilities> = {
  'ios-sim': { rigidRotation: true, recording: true, previewQuality: true, hardwareKeyboard: true, rotation: true, semanticTree: true },
  'android': { rigidRotation: false, recording: true, previewQuality: false, hardwareKeyboard: false, rotation: true, semanticTree: true },
  // Every false here is a property of reaching a phone through somebody else's window.
  // The picture is whatever size that window happens to be, it turns only when the
  // phone does, there is no recorder behind it, and no tree inside it.
  'ios-mirror': { rigidRotation: false, recording: false, previewQuality: false, hardwareKeyboard: false, rotation: false, semanticTree: false },
}

export interface DeviceDescriptor {
  /**
   * Stable handle, platform-prefixed: `ios:<udid>`, `android:<serial>`.
   *
   * The prefix is load-bearing rather than decorative — it is what lets a single
   * string route to the right backend, so no signature below this point needs to
   * carry a platform alongside the id it already has.
   */
  id: string
  /**
   * How this device is reached — and the prefix of `id` above.
   *
   * The key for routing and for `DEVICE_CAPABILITIES`. Carried rather than parsed
   * back out of the id at each use: every consumer already holds the descriptor.
   */
  provider: DeviceProvider
  /** What it runs. Derived from `provider`; here so the UI can group without a lookup. */
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

/** Android 14 removed screenrecord's historical three-minute ceiling. */
export const ANDROID_UNLIMITED_SCREEN_RECORDING_API_LEVEL = 34
export const ANDROID_LEGACY_SCREEN_RECORDING_LIMIT_SECONDS = 180

/** Natural platform recording limit, or null when the provider records indefinitely. */
export function deviceRecordingMaxDurationMs(
  device: Pick<DeviceDescriptor, 'provider' | 'versionRank'>,
): number | null {
  if (
    device.provider !== 'android'
    || device.versionRank >= ANDROID_UNLIMITED_SCREEN_RECORDING_API_LEVEL
  ) {
    return null
  }
  return ANDROID_LEGACY_SCREEN_RECORDING_LIMIT_SECONDS * 1000
}

/**
 * Split `ios-sim:UDID` back into its parts. Null when the handle names no provider.
 *
 * A bare `ios:` prefix reads as `ios-sim`, because that is what every id written
 * before providers existed meant. Ids reach localStorage recents and agent
 * transcripts, so old ones keep arriving long after nothing writes them.
 */
export function parseDeviceId(
  id: string,
): { provider: DeviceProvider; native: string } | null {
  const separator = id.indexOf(':')
  if (separator <= 0) return null
  const prefix = id.slice(0, separator)
  const native = id.slice(separator + 1)
  if (!native) return null
  const provider = prefix === 'ios' ? 'ios-sim' : prefix
  if (!DEVICE_PROVIDERS.includes(provider as DeviceProvider)) return null
  return { provider: provider as DeviceProvider, native }
}

/** Whether an agent-facing id/name reference names this descriptor. */
export function deviceMatchesReference(device: DeviceDescriptor, ref: string): boolean {
  const needle = ref.trim().toLowerCase()
  if (!needle) return false
  if (device.id.toLowerCase() === needle) return true
  if (parseDeviceId(device.id)?.native.toLowerCase() === needle) return true
  if (device.name.toLowerCase() === needle) return true
  const label = `${device.name} ${device.platformVersion}`.toLowerCase()
  return label.includes(needle) || needle.includes(device.name.toLowerCase())
}

export function formatDeviceId(provider: DeviceProvider, native: string): string {
  return `${provider}:${native}`
}

/**
 * An id read back from storage, in today's shape.
 *
 * Two older spellings still arrive: a bare udid, from before ids carried a prefix at
 * all, and an `ios:` prefix, from before providers existed. Both meant the simulator
 * — nothing else could write one. Normalising on read is what lets a remembered
 * device still match a catalog entry, which is the whole point of remembering it.
 */
export function normalizeDeviceId(id: string): string {
  const parsed = parseDeviceId(id)
  return parsed ? formatDeviceId(parsed.provider, parsed.native) : formatDeviceId('ios-sim', id)
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
  deviceId: string
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
 * What this angle MEANS differs by provider, which is what `DEVICE_CAPABILITIES`
 * is for. Read `rigidRotation` there before using this to lay anything out.
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

/** The concrete device an agent tool resolved, used to select the session PiP. */
export interface DeviceViewfinderClaim {
  sessionId: string
  deviceId: string
}

/**
 * What one DEVICE is doing, and who has it.
 *
 * Keyed by the device rather than by the session that holds it, because the device
 * is what the reading is ABOUT: a session may hold several at once, and a device
 * changing hands has to reach both the session taking it and the one losing it.
 * Addressed to the session, the loser's panel could only be told about its loss by a
 * second, deviceless message invented for the purpose.
 *
 * `owner` is therefore the answer to "is this still mine" — a panel compares it with
 * its own session id, and a mismatch IS the loss notification.
 */
export interface DeviceState {
  /** The device this describes. Every reader routes on it. */
  deviceId: string
  /** The chat session holding it, or null when nobody is. */
  owner: string | null
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
  /**
   * Why a mirrored iPhone is not usable right now, in macOS's own words.
   *
   * Not `error`, because none of these are errors: "iPhone in Use", paused, locked,
   * and the initial connect prompt are ordinary states of a feature that belongs to
   * the user, not failures of ours. Rendering them as errors would put a red banner
   * on a phone that is simply in somebody's hand.
   *
   * Carried verbatim rather than mapped to an enum: the strings come from the screen
   * macOS drew, so they are already in the user's language and already cover whatever
   * screen Apple adds next.
   */
  mirror?: { reason: string }
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
