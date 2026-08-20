export const IOS_SIMULATOR_PROTOCOL_VERSION = 7 as const
export const IOS_SIMULATOR_MAX_TOUCH_CONTACTS = 2 as const

/**
 * `UIDeviceOrientation`, which is the vocabulary the guest workspace accepts. Apple's
 * `left`/`right` naming describes where the home button ends up, not which way the
 * device turned, so never infer the on-screen rotation from the name — use
 * `IOS_SIMULATOR_ROTATION_DEGREES`.
 */
export type IosSimulatorOrientation =
  | 'portrait'
  | 'landscape-left'
  | 'portrait-upside-down'
  | 'landscape-right'

/**
 * How far clockwise the device is lying, which is both how far the host turns the
 * shell and how far it has to turn the framebuffer to read upright.
 *
 * The framebuffer never changes shape: the guest draws its rotated UI into the same
 * portrait surface, exactly like a real panel, so one CSS rotation carries artwork
 * and picture together.
 *
 * The landscape pair is the trap. `landscapeLeft` puts the home button on the RIGHT,
 * so the device's top edge points left -- a quarter turn ANTI-clockwise, 270deg on
 * screen -- and `landscapeRight` is the mirror of that. Reading the names as turn
 * directions lands both of them 180deg out, which shows up as a landscape picture
 * printed upside down inside a correctly-turned body.
 */
export const IOS_SIMULATOR_ROTATION_DEGREES: Record<IosSimulatorOrientation, number> = {
  'portrait': 0,
  'landscape-right': 90,
  'portrait-upside-down': 180,
  'landscape-left': 270,
}

/** Clockwise order, so stepping forward turns the device to the right. */
export const IOS_SIMULATOR_ORIENTATION_CYCLE = [
  'portrait',
  'landscape-right',
  'portrait-upside-down',
  'landscape-left',
] as const satisfies readonly IosSimulatorOrientation[]

export function stepIosSimulatorOrientation(
  orientation: IosSimulatorOrientation,
  direction: 'left' | 'right',
): IosSimulatorOrientation {
  const cycle = IOS_SIMULATOR_ORIENTATION_CYCLE
  const index = cycle.indexOf(orientation)
  const next = (index + (direction === 'right' ? 1 : cycle.length - 1)) % cycle.length
  return cycle[next]!
}

/**
 * Characters a simulated hardware keyboard can actually produce.
 *
 * Indigo's keyboard channel carries HID usage codes and nothing else — even
 * `IndigoHIDMessageForKeyboardNSEvent` only reads the event's `keyCode` and looks the
 * usage up in a table, so no Unicode ever crosses it. Anything outside this set,
 * Chinese and emoji included, has to reach the device through its pasteboard.
 *
 * Mirrors `S1CharacterUsage` in `HIDBridge.m`; widen both together.
 */
// eslint-disable-next-line no-control-regex
const TYPEABLE = /^[\u0008\u0009\u000a\u000d\u0020-\u007e\u007f]*$/

/**
 * Below this, a keystroke goes out as a keystroke. Above it the pasteboard is both
 * faster and less fragile: the helper holds its serial input queue for ~22ms per
 * character, so a pasted paragraph would otherwise block touches for seconds.
 */
export const IOS_SIMULATOR_MAX_TYPED_CHARACTERS = 8

export function canTypeIosSimulatorText(text: string): boolean {
  return text.length <= IOS_SIMULATOR_MAX_TYPED_CHARACTERS && TYPEABLE.test(text)
}

export type IosSimulatorPreviewMode = 'native-framebuffer' | 'native-h264'

export interface IosSimulatorApiCapabilities {
  coreSimulator: boolean
  framebuffer: boolean
  hid: boolean
  /** Rotation rides CoreSimulator's port lookup, not SimulatorKit, so it is separate. */
  rotation: boolean
  accessibility: boolean
  videoEncoder: boolean
}

export interface IosSimulatorHelperProbe {
  protocolVersion: number
  developerDirectory: string
  simulatorKitPath: string | null
  capabilities: IosSimulatorApiCapabilities
  missingSymbols: string[]
  error?: string
}

export interface IosSimulatorStatus {
  supported: boolean
  platform: string
  developerDirectory: string | null
  xcodeVersion: string | null
  xcodeBuild: string | null
  simctlPath: string | null
  previewMode: IosSimulatorPreviewMode
  helper: IosSimulatorHelperProbe | null
  error?: string
}

export interface IosSimulatorDevice {
  udid: string
  name: string
  /** Keys into the device type catalogue, which is where the chrome artwork lives. */
  deviceTypeIdentifier?: string
  runtimeIdentifier: string
  runtimeName: string
  state: string
  booted: boolean
  available: boolean
  availabilityError?: string
  ownedBySuperOne: boolean
  boundSessionId?: string
}

export interface IosSimulatorSessionState {
  sessionId: string
  device: IosSimulatorDevice | null
  phase: 'idle' | 'booting' | 'ready' | 'stopping' | 'error'
  previewMode: IosSimulatorPreviewMode
  interactive: boolean
  /** What the host last told the guest. A guest-driven rotation is not observable. */
  orientation: IosSimulatorOrientation
  /**
   * Whether the guest thinks a hardware keyboard is plugged in -- and so, inversely,
   * whether it will raise its own on-screen keyboard when a field takes focus. Like
   * `orientation` this is what the host last pushed: CoreSimulator has no getter.
   */
  hardwareKeyboardConnected: boolean
  /** False when this CoreSimulator has no hardware-keyboard switch to offer. */
  hardwareKeyboardAvailable: boolean
  /** The device's own framebuffer size. Absent until the native helper attaches. */
  pixelWidth?: number
  pixelHeight?: number
  message?: string
}

export interface IosSimulatorFrame {
  sessionId: string
  sequence: number
  timestampMs: number
  timestampUs?: number
  mimeType: 'image/png' | 'video/avc'
  keyframe: boolean
  codecConfig: boolean
  codec?: string
  codedWidth?: number
  codedHeight?: number
  data: Uint8Array
}

export type IosSimulatorTouchPhase = 'began' | 'moved' | 'ended' | 'cancelled'

export interface IosSimulatorTouchContact {
  id: number
  xRatio: number
  yRatio: number
  phase: IosSimulatorTouchPhase
}

export type IosSimulatorInput =
  | { type: 'touch.update'; contacts: IosSimulatorTouchContact[] }
  | { type: 'touch.cancel' }
  | { type: 'tap'; xRatio: number; yRatio: number }
  | { type: 'drag'; startXRatio: number; startYRatio: number; endXRatio: number; endYRatio: number; durationMs?: number }
  | { type: 'text'; text: string }
  /** Command-V. The host puts the text on the device's own pasteboard first. */
  | { type: 'paste' }
  | { type: 'rotate'; orientation: IosSimulatorOrientation }
  | { type: 'button'; button: 'home' | 'lock' | 'side' | 'volume-up' | 'volume-down' }
  /**
   * Plugs the simulated hardware keyboard in or out, which is the only lever over
   * the guest's on-screen keyboard: iOS raises that one exactly when a field has
   * focus and no hardware keyboard is attached.
   */
  | { type: 'keyboard'; connected: boolean }

export interface IosSimulatorInputResult {
  ok: boolean
  skippedCharacters?: number
  error?: string
}

/**
 * Preview-only knobs. Screenshots and recordings read the device display through
 * simctl, so neither of these touches what gets captured to disk.
 */
export interface IosSimulatorPreviewQuality {
  /** Fraction of the device's framebuffer size. 1 keeps the zero-copy encode path. */
  scale: number
  /** Frames-per-second ceiling. 0 forwards every repaint the simulator produces. */
  maxFrameRate: number
}

export const IOS_SIMULATOR_PREVIEW_SCALES = [1, 0.75, 0.5, 0.33] as const
export const IOS_SIMULATOR_PREVIEW_FRAME_RATES = [0, 60, 30, 15] as const

export const DEFAULT_IOS_SIMULATOR_PREVIEW_QUALITY: IosSimulatorPreviewQuality = {
  scale: 1,
  maxFrameRate: 0,
}

export type IosSimulatorCaptureKind = 'screenshot' | 'video'

/**
 * A file the panel captured off the device, parked in this session's capture
 * directory. Carries the file name separately so a toast can name the file
 * without the renderer having to split a path.
 */
export interface IosSimulatorCapture {
  kind: IosSimulatorCaptureKind
  path: string
  fileName: string
}

export interface IosSimulatorDeviceTypeOption {
  identifier: string
  name: string
  /** Apple's own family label: 'iPhone' | 'iPad' | 'Apple Watch' | 'Apple TV' | 'Apple Vision'. */
  productFamily: string
}

export interface IosSimulatorRuntimeOption {
  identifier: string
  name: string
  version: string
  /** Exactly the models Apple allows on this runtime — no cartesian product needed. */
  deviceTypes: IosSimulatorDeviceTypeOption[]
}

export interface IosSimulatorCreateRequest {
  name: string
  deviceTypeIdentifier: string
  runtimeIdentifier: string
}

/**
 * A physical button, in the device's own point space.
 *
 * Apple ships each one as its own PDF and draws it *under* the body, so only a
 * sliver protrudes at rest and hovering slides it further out. That only works
 * against the nine-slice edge artwork, which is why the composite — a flat picture
 * of the body with no buttons drawn in it at all and no room at the edge — is not
 * what this panel renders.
 */
export interface IosSimulatorChromeButton {
  name: string
  title: string
  /** Which edge of the device the button sits on. */
  anchor: 'left' | 'right' | 'top' | 'bottom'
  /**
   * `across` is how far the button pokes out past that edge; `along` is its position
   * down (or across) the edge, negative meaning measured from the far end. Apple
   * stores these as x/y whose meaning flips with the anchor, so they are named here.
   */
  offset: { across: number; along: number }
  /** Where it slides to while hovered. Apple only ever moves `across`. */
  hoverOffset: { across: number; along: number }
  width: number
  height: number
  /** PNG data URL of the button, and of Apple's pressed variant when it ships one. */
  image: string
  pressedImage?: string
  /** Set when this button maps onto an input the helper can actually send. */
  input?: 'home' | 'lock' | 'side' | 'volume-up' | 'volume-down'
}

/** The eight edge images of the body, each a PNG data URL. */
export interface IosSimulatorChromeSlices {
  topLeft: string
  top: string
  topRight: string
  right: string
  bottomRight: string
  bottom: string
  bottomLeft: string
  left: string
}

/**
 * Apple's own device artwork, read from the local Xcode install. Never bundled:
 * these are Apple's copyrighted assets, and the panel already requires Xcode.
 */
export interface IosSimulatorChrome {
  identifier: string
  /** Nine-slice body. Corners are square and `corner` points on a side. */
  slices: IosSimulatorChromeSlices
  corner: number
  /** PNG alpha mask carrying the exact screen corner shape. */
  screenMask: string
  /** The device body, in points — screen plus its own frame, per device. */
  width: number
  height: number
  /** Room reserved outside the body for the buttons to protrude into. */
  padding: { top: number; left: number; bottom: number; right: number }
  /** Where the framebuffer sits inside the body, in points. */
  screen: { x: number; y: number; width: number; height: number }
  buttons: IosSimulatorChromeButton[]
}
