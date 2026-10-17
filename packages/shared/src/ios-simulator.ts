import type { DeviceOrientation } from './device-agent'
import type { DeviceTextSegment } from './device'
import {
  DEVICE_MAX_TOUCH_CONTACTS,
  DEVICE_ORIENTATION_CYCLE,
  DEVICE_ROTATION_DEGREES,
  isDeviceLandscape,
  splitDeviceText,
  stepDeviceOrientation,
} from './device'

export const IOS_SIMULATOR_PROTOCOL_VERSION = 11 as const
/**
 * The neutral device vocabulary, under this platform's old names.
 *
 * Aliases rather than copies: orientation, its clockwise cycle and the contact cap
 * are identical on both platforms, and two tables that must agree eventually do not.
 * `@superone/shared/device` is where they live; these keep every existing iOS call
 * site — and its comments about what the names mean — reading as it did.
 */
export type IosSimulatorOrientation = DeviceOrientation
export const IOS_SIMULATOR_MAX_TOUCH_CONTACTS = DEVICE_MAX_TOUCH_CONTACTS
export const IOS_SIMULATOR_ROTATION_DEGREES = DEVICE_ROTATION_DEGREES
export const IOS_SIMULATOR_ORIENTATION_CYCLE = DEVICE_ORIENTATION_CYCLE
export const isIosSimulatorLandscape = isDeviceLandscape
export const stepIosSimulatorOrientation = stepDeviceOrientation
/** Shared with Android: both platforms made the same routing mistake. */
export type IosSimulatorTextSegment = DeviceTextSegment
export const splitIosSimulatorText = splitDeviceText

/**
 * Characters a simulated hardware keyboard can actually produce.
 *
 * Indigo's keyboard channel carries HID usage codes and nothing else — even
 * `IndigoHIDMessageForKeyboardNSEvent` only reads the event's `keyCode` and looks the
 * usage up in a table, so no Unicode ever crosses it. Anything outside this set,
 * Chinese and emoji included, has to reach the device through direct insertion.
 *
 * Mirrors `S1CharacterUsage` in `HIDBridge.m`; widen both together.
 */
// eslint-disable-next-line no-control-regex
const TYPEABLE = /^[\u0008\u0009\u000a\u000d\u0020-\u007e\u007f]*$/

export function isIosSimulatorTextTypeable(text: string): boolean {
  return TYPEABLE.test(text)
}

export type IosSimulatorPreviewMode = 'native-framebuffer' | 'native-h264'

/**
 * A foldable's postures, named and numbered as the Android emulator names its own
 * (`adb emu posture`), so `device_configure` speaks one vocabulary on both platforms.
 */
export const IOS_SIMULATOR_FOLD_POSTURES = [
  { id: 1, posture: 'closed', label: 'closed', hingeDegrees: 0 },
  { id: 2, posture: 'half-opened', label: 'half opened', hingeDegrees: 90 },
  { id: 3, posture: 'opened', label: 'opened', hingeDegrees: 180 },
  // Half open and stood on its edges, the cover facing out: what lights the cover
  // with the hinge open. Not an angle; see `IosSimulatorFoldState.tent`.
  { id: 5, posture: 'tent', label: 'tent', hingeDegrees: 60 },
] as const

/** The widest opening that still stands as a tent; any wider is the inner screen. */
export const IOS_SIMULATOR_TENT_MAX_DEGREES = 60

/**
 * Where an angle puts the hinge; null off 0-180. The angle alone picks the form:
 * 0 closed on the cover, up to `IOS_SIMULATOR_TENT_MAX_DEGREES` a tent on the cover,
 * anything wider open on the inner screen.
 */
export function iosSimulatorFoldAt(hingeDegrees: number): IosSimulatorFoldPosition | null {
  if (!Number.isFinite(hingeDegrees) || hingeDegrees < 0 || hingeDegrees > 180) return null
  return { hingeDegrees, tent: hingeDegrees > 0 && hingeDegrees <= IOS_SIMULATOR_TENT_MAX_DEGREES }
}

/** A foldable's three forms, by the angle that picks them. */
export type IosSimulatorFoldForm = 'closed' | 'tent' | 'open'

export function iosSimulatorFoldForm(hingeDegrees: number): IosSimulatorFoldForm {
  return hingeDegrees <= 0 ? 'closed' : hingeDegrees <= IOS_SIMULATOR_TENT_MAX_DEGREES ? 'tent' : 'open'
}

export type IosSimulatorFoldPosture = typeof IOS_SIMULATOR_FOLD_POSTURES[number]['posture']

export function iosSimulatorFoldPosture(posture: IosSimulatorFoldPosture) {
  return IOS_SIMULATOR_FOLD_POSTURES.find((entry) => entry.posture === posture)!
}

/** The posture a fold reads as: a tent, else by angle, where only the two ends are exact. */
export function iosSimulatorFoldPostureOf(fold: IosSimulatorFoldPosition) {
  const { hingeDegrees, tent } = fold
  return iosSimulatorFoldPosture(tent ? 'tent'
    : hingeDegrees <= 0 ? 'closed' : hingeDegrees >= 180 ? 'opened' : 'half-opened')
}

/**
 * The panel the guest paints: the cover while closed or standing as a tent, else the
 * inner panel. The guest swaps only when a sweep crosses its swap point, so leaving a
 * tent for another angle closes first to keep this true; see `IosSimulatorManager`.
 */
export function iosSimulatorFoldPanel(fold: IosSimulatorFoldPosition): IosSimulatorFoldState['panel'] {
  return fold.tent || fold.hingeDegrees <= 0 ? 'cover' : 'inner'
}

/** Where a foldable's hinge is: its angle, and whether it stands as a tent. */
export type IosSimulatorFoldPosition = Pick<IosSimulatorFoldState, 'hingeDegrees' | 'tent'>

/** A foldable's hinge, which panel it shows, and how that panel is mounted. */
export interface IosSimulatorFoldState {
  /** 0 closed to 180 open. The guest takes any angle; postures are named stops on it. */
  hingeDegrees: number
  /**
   * Standing half open on its edges with the cover lit, landscape with the hinge on
   * top. A CoreMotion pose rather than an angle, so it is carried beside the angle.
   */
  tent: boolean
  panel: 'cover' | 'inner'
  /**
   * Clockwise turn that stands the shown panel's framebuffer upright. The Duo's inner
   * panel is mounted sideways (`nativeRotation` 270), so its framebuffer is portrait
   * while the unfolded device is held landscape.
   */
  panelRotation: 0 | 90 | 180 | 270
}

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
  /** The simulator this reading is about. Carried so the adapter can key on it. */
  udid: string
  /** The session holding it. Empty when nobody is. */
  sessionId: string
  device: IosSimulatorDevice | null
  phase: 'idle' | 'booting' | 'ready' | 'stopping' | 'error'
  previewMode: IosSimulatorPreviewMode
  interactive: boolean
  /**
   * Which way up the guest is lying. Set only once a rotation the host asked for
   * was seen to land — apps that pin themselves upright never turn — so this is a
   * reading, not a request. A rotation the guest starts on its own stays invisible.
   */
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
  /**
   * Present only on a foldable. Host-owned like `orientation`: the guest has no getter
   * for its hinge, so this is the angle the host last moved it to.
   */
  fold?: IosSimulatorFoldState
  message?: string
}

export interface IosSimulatorFrame {
  deviceId: string
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
  /**
   * Write text into the focused editable control directly, past the guest's keyboard.
   *
   * `replace` decides whether the control's whole value is overwritten or the text is
   * spliced into its selection. Overwriting is a write with no read, which is the only
   * shape that cannot go wrong: an empty field reports its PLACEHOLDER as `AXValue`,
   * so splicing into one used to commit the placeholder as real text.
   */
  | { type: 'insertText'; text: string; replace?: boolean }
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
  /**
   * The helper's own reason code, when it had one. See `IOS_SIMULATOR_INPUT_ERROR`.
   *
   * Carried separately from `error` because two of these mean opposite things to a
   * caller — one says "try again in a moment", the other says "this control will never
   * take text, use the keyboard" — and telling them apart by matching English prose is
   * how a fallback silently starts firing on the wrong failure.
   */
  code?: number
}

/**
 * Reason codes the helper's accessibility bridge reports, mirroring the `NSError`
 * codes in `AccessibilityBridge.m`. Widen both together.
 */
export const IOS_SIMULATOR_INPUT_ERROR = {
  /** Nothing has focus yet. Retryable: a tap's focus takes a moment to land. */
  NOT_FOCUSED: 31,
  /** The focused control refuses to be written to. Not retryable; use the keyboard. */
  NOT_EDITABLE: 32,
} as const

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

/** A body drawn from Apple's nine-slice edges, which stretch to any device size. */
export interface IosSimulatorChromeSliceBody {
  /** Corners are square and `corner` points on a side. */
  slices: IosSimulatorChromeSlices
  corner: number
  composite?: undefined
}

/**
 * A body drawn as one PNG data URL covering exactly `width` × `height`. Used when a
 * chrome ships placeholder slices (the iPhone Duo's) and only its composite is real.
 */
export interface IosSimulatorChromeCompositeBody {
  composite: string
  slices?: undefined
  corner?: undefined
}

/**
 * Apple's own device artwork, read from the local Xcode install. Never bundled:
 * these are Apple's copyrighted assets, and the panel already requires Xcode.
 */
export type IosSimulatorChrome = (IosSimulatorChromeSliceBody | IosSimulatorChromeCompositeBody) & {
  identifier: string
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
