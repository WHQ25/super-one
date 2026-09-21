import type {
  CapturedImage,
  CaptureScope,
  CoordinateSpace,
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
  /**
   * The native walk stopped short of the real tree. Distinct from the fold
   * budget: this happened before TypeScript ever saw the nodes, so no amount of
   * compaction recovers them and `computer_query` cannot find them either.
   */
  outlineTruncated?: boolean
}

export interface PlatformActRequest {
  root: UiRootIdentity
  actions: UiAction[]
  /** Coordinate space that the state outline bounds were measured in. */
  coordinateSpace?: CoordinateSpace
  /** Focused element ref inherited across steps (service-managed). */
  focusRef?: string
  /**
   * Outline from the state being acted on (for ref → AX index / bounds).
   * Required for ref-targeted actions; the platform picks the input path
   * (AX action or posted event) per action from it.
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

/** An on-screen window over a point of another window, as the window server stacks them. */
export interface WindowCover {
  windowId: number
  pid: number
  app: string
}

export interface PlatformRecordingResult {
  path: string
  mimeType: string
  durationMs: number
  width?: number
  height?: number
}

/**
 * OS adapter boundary. P0 uses FakePlatformBackend only.
 * Real helpers implement the same surface over unix socket / UIA / AT-SPI.
 */
export interface PlatformAdapter {
  listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>>
  look(root: UiRootIdentity, mode: ObserveMode, capture: CaptureScope): Promise<PlatformLook>
  act(req: PlatformActRequest): Promise<PlatformActResult>
  /** Optional fail-closed recording around one action transaction. */
  startRecording?(root: UiRootIdentity, outputPath: string): Promise<void>
  stopRecording?(): Promise<PlatformRecordingResult>
  /** Capture a sub-region of the last look for a root without changing coordinate space. */
  zoom?(
    root: UiRootIdentity,
    region: [number, number, number, number],
    coordinateSpace: CoordinateSpace,
  ): Promise<CapturedImage>
  /**
   * Optional: close a context menu the agent opened, once it has been read.
   * A menu is the app's own pop-up-level window and draws above the user's;
   * a state taken from it stays usable, the service reopens the menu to act.
   */
  dismissRoot?(root: UiRootIdentity): Promise<void>
  /**
   * Optional: the window a drop at each point would reach when it is not the
   * root's own — `null` where the root is uncovered there. Posted pointer
   * events are routed to a window by number and reach it under anything; a
   * drop is resolved by the drag manager against the real stacking order, so
   * a covered drop point is delivered to whatever covers it.
   */
  coveringWindows?(root: UiRootIdentity, points: Array<{ x: number; y: number }>, coordinateSpace: CoordinateSpace): Promise<Array<WindowCover | null>>
  /**
   * Optional: bring app/window forward or launch. `activate` makes the app
   * frontmost — off by default, because Computer Use works in the background;
   * on only for a sequence of steps that needs the app to stay active.
   */
  focusApp?(app: string, options?: { activate?: boolean }): Promise<void>
  launchApp?(app: string): Promise<void>
  /** Optional: running apps (bundle + frontmost) for computer_apps. */
  listApps?(): Promise<Array<{ app: string; bundleId: string; pid: number; frontmost: boolean }>>
  /** Optional: frontmost process, for computer_apps and tests. */
  frontmost?(): Promise<{ app: string; bundleId: string; pid: number } | null>
  /**
   * Hide software cursor + menu-bar control chip immediately.
   * Called when the agent is no longer controlling (idle / interrupt / dispose / target quit).
   */
  clearVisuals?(): Promise<void>
}
