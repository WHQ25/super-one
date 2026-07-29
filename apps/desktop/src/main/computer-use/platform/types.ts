import type {
  CapturedImage,
  CaptureScope,
  CoordinateSpace,
  DeliveryMode,
  ObserveMode,
  UiAction,
  UiOutlineNode,
  UiRootIdentity,
} from '../types'

export interface PlatformLook {
  root: Omit<UiRootIdentity, 'rootId'> & { rootId?: string }
  outline: UiOutlineNode
  image?: CapturedImage
  coordinateSpace: CoordinateSpace
  nativeLookId: string
}

export interface PlatformActRequest {
  root: UiRootIdentity
  actions: UiAction[]
  delivery: DeliveryMode
  /** Coordinate space that the state outline bounds were measured in. */
  coordinateSpace?: CoordinateSpace
  /** Focused element ref inherited across steps (service-managed). */
  focusRef?: string
  /**
   * Outline from the state being acted on (for ref → AX index / bounds).
   * Required for ref-targeted and delivery=semantic actions.
   */
  outline?: UiOutlineNode
}

export interface PlatformActStepResult {
  applied: boolean
  /** True when the platform can confirm the action had no effect. */
  confirmedNoEffect?: boolean
  /** True when the platform cannot tell (silent delivery). */
  unknown?: boolean
  focusRef?: string
  description: string
  before?: { value?: string; name?: string }
  after?: { value?: string; name?: string }
}

export interface PlatformActResult {
  steps: PlatformActStepResult[]
  stoppedAt?: number
}

/**
 * OS adapter boundary. P0 uses FakePlatformBackend only.
 * Real helpers implement the same surface over unix socket / UIA / AT-SPI.
 */
export interface PlatformAdapter {
  listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>>
  look(root: UiRootIdentity, mode: ObserveMode, capture: CaptureScope): Promise<PlatformLook>
  act(req: PlatformActRequest): Promise<PlatformActResult>
  /** Capture a sub-region of the last look for a root without changing coordinate space. */
  zoom?(
    root: UiRootIdentity,
    region: [number, number, number, number],
    coordinateSpace: CoordinateSpace,
  ): Promise<CapturedImage>
  /** Optional: bring app/window forward or launch. */
  focusApp?(app: string): Promise<void>
  launchApp?(app: string): Promise<void>
  /** Optional: running apps (bundle + frontmost) for computer_apps. */
  listApps?(): Promise<Array<{ app: string; bundleId: string; pid: number; frontmost: boolean }>>
  /** Optional: frontmost process for action-level gate. */
  frontmost?(): Promise<{ app: string; bundleId: string; pid: number } | null>
  /**
   * Hide software cursor + menu-bar control chip immediately.
   * Called when the agent is no longer controlling (idle / interrupt / dispose / target quit).
   */
  clearVisuals?(): Promise<void>
}
