/**
 * Computer Use domain types (P0 contract).
 * IPC-safe subsets may later move to @superone/shared; native protocol stays here.
 */

export type RootKind = 'window' | 'menu' | 'sheet' | 'popover' | 'dialog'

export type ObserveMode = 'visual' | 'semantic' | 'fused'

export type CaptureScope = 'window' | 'display'

export type DeliveryMode = 'semantic' | 'app-directed' | 'physical'

export type ActionOutcome = 'worked' | 'didnt' | 'unknown'

export type CapabilityTier = 'read' | 'click' | 'full'

export type WaitStatus = 'verified' | 'preexisting' | 'failed'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CoordinateSpace {
  /** Width/height of the image coordinate system exposed to the agent. */
  width: number
  height: number
  /** Backing pixels per macOS logical point at capture time. */
  scale: number
  /** True only for display capture; zoom must not create a new space. */
  fullScreen: boolean
  /** Capture scope that established this coordinate system. */
  kind?: CaptureScope
  /** Stable macOS CGWindowNumber for window-local coordinates. */
  windowId?: number
  /** Global logical bounds sampled when this coordinate system was captured. */
  capturedBounds?: Bounds
  /** Global logical bounds of the display containing the capture. */
  displayBounds?: Bounds
}

export interface CapturedImage {
  mimeType: 'image/png' | string
  /**
   * Absolute file path after persist (tool results to the agent).
   * Prefer this over `data` — matches browser_screenshot.
   */
  path?: string
  /**
   * Base64 pixels (in-memory / helper wire only). Stripped from MCP tool JSON
   * after writing to disk so agents get a path, not a multi-MB string.
   */
  data?: string
  width: number
  height: number
}

export interface UiRootIdentity {
  rootId: string
  kind: RootKind
  app: string
  bundleId: string
  pid: number
  title: string
  bounds: Bounds
  focused: boolean
  visible: boolean
  minimized: boolean
  modal: boolean
  /** Desktop scheduling key — typically process-scoped. */
  resourceKey: string
  /**
   * macOS CGWindowNumber — used so the agent overlay can stack at the same
   * z-order as this window (not always-on-top).
   */
  windowId?: number
  /** macOS kCGWindowLayer (0 = normal app window). */
  windowLayer?: number
}

export interface UiNodeCapabilities {
  press?: boolean
  setText?: boolean
  typeText?: boolean
  scroll?: boolean
  focus?: boolean
}

/** Full internal outline node (complete tree kept in StateStore). */
export interface UiOutlineNode {
  ref: string
  role: string
  name?: string
  value?: string
  bounds?: Bounds
  enabled?: boolean
  focused?: boolean
  /** When true, visual-only; cannot be a semantic action target. */
  pictureOnly?: boolean
  capabilities?: UiNodeCapabilities
  children?: UiOutlineNode[]
}

export interface ComputerUseState {
  stateId: string
  resourceKey: string
  epoch: number
  root: UiRootIdentity
  capturedAt: number
  /** Complete outline for query / expand / inspect. */
  outline: UiOutlineNode
  /** Optional visual evidence. */
  image?: CapturedImage
  coordinateSpace: CoordinateSpace
  mode: ObserveMode
  capture: CaptureScope
  nativeLookId: string
}

export type UiAction =
  | { type: 'press'; ref: string }
  | { type: 'click'; ref?: string; x?: number; y?: number; button?: 'left' | 'right' }
  | { type: 'setText'; ref: string; text: string }
  | { type: 'typeText'; ref?: string; text: string }
  | { type: 'keypress'; keys: string[] }
  | { type: 'scroll'; ref?: string; dx?: number; dy?: number }
  | { type: 'drag'; path: Array<{ x: number; y: number }> }
  | { type: 'moveMouse'; x: number; y: number }

export type Condition =
  | { kind: 'exists'; ref: string }
  | { kind: 'notExists'; ref: string }
  | { kind: 'textEquals'; ref: string; text: string }
  | { kind: 'textContains'; ref: string; text: string }
  | { kind: 'valueEquals'; ref: string; value: string }

export interface StateDiff {
  added: string[]
  removed: string[]
  changed: Array<{ ref: string; field: string; from?: string; to?: string }>
  /** When identity is ambiguous, clients should treat the successor as a full view. */
  fullViewFallback: boolean
}

export interface ActEvidence {
  description: string
  before?: { value?: string; name?: string }
  after?: { value?: string; name?: string }
}

export interface ActResult {
  outcome: ActionOutcome
  evidence: ActEvidence[]
  grounding: DeliveryMode
  stoppedAt?: number
  successorStateId: string
  /** Fresh visual evidence for the successor, when the observe mode includes pixels. */
  successorImage?: CapturedImage
  successorCoordinateSpace: CoordinateSpace
  diff?: StateDiff
}

export interface WaitResult {
  status: WaitStatus
  successorStateId: string
}

export type GrantScope = 'session' | 'always'

export interface GrantedApp {
  app: string
  bundleId: string
  tier: CapabilityTier
  /** Where the grant came from. Omitted for allow-all wildcard entries. */
  scope?: GrantScope
}

export interface AppsSnapshot {
  granted: GrantedApp[]
  running: Array<{
    app: string
    bundleId: string
    pid: number
    frontmost: boolean
  }>
  /**
   * Discoverable UI roots (`@rN`) for observe/act targeting.
   * Prefer these over guessing frontmost when multiple windows exist.
   */
  roots: Array<{
    rootId: string
    kind: RootKind
    app: string
    bundleId: string
    pid: number
    title: string
    focused: boolean
    modal: boolean
  }>
  frontmost: string | null
  clipboardGrant: boolean
}

export interface ObserveResult {
  stateId: string
  root: UiRootIdentity
  image?: CapturedImage
  /** Folded outline returned to the model (not the full internal tree). */
  outline: UiOutlineNode
  truncation: { nodesOmitted: number; maxDepth: number }
  coordinateSpace: CoordinateSpace
  mode: ObserveMode
  capture: CaptureScope
}

export interface QueryResult {
  matches?: Array<{ ref: string; role: string; name?: string; value?: string; path: string[] }>
  subtree?: UiOutlineNode
  element?: UiOutlineNode
}

export interface ZoomResult {
  image: CapturedImage
  /** Region in the parent state's coordinate space. */
  region: [number, number, number, number]
  /** Always the same coordinateSpace as the parent state — never a new one. */
  coordinateSpace: CoordinateSpace
  stateId: string
}

/** Errors that are part of the public contract (stable codes). */
export type ComputerUseErrorCode =
  | 'STALE_STATE'
  | 'UNKNOWN_STATE'
  | 'UNKNOWN_ROOT'
  | 'UNKNOWN_REF'
  | 'REF_WRONG_STATE'
  | 'NOT_GRANTED'
  | 'TIER_BLOCKED'
  | 'INVALID_ACTION'
  | 'OUTPUT_TOO_LARGE'
  | 'CONDITION_TIMEOUT'
  | 'BACKEND'

export class ComputerUseError extends Error {
  readonly code: ComputerUseErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: ComputerUseErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ComputerUseError'
    this.code = code
    this.details = details
  }
}

export const DEFAULT_STATE_LIMIT = 128
export const DEFAULT_FOLD_DEPTH = 2
export const DEFAULT_FOLD_MAX_NODES = 40
export const DEFAULT_OUTPUT_MAX_CHARS = 48 * 1024
export const DEFAULT_OUTPUT_PREVIEW_CHARS = 16 * 1024
export const DEFAULT_MAX_ACTIONS = 20
