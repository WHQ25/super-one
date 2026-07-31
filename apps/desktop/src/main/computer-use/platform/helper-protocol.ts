/** Wire protocol shared with native/computer-use-helper (line-delimited JSON). */

export type HelperMethod =
  | 'ping'
  | 'doctor'
  | 'set_host'
  | 'list_apps'
  | 'frontmost'
  | 'list_windows'
  | 'ax_tree'
  | 'ax_action'
  | 'focus_app'
  | 'launch_app'
  | 'capture'
  | 'zoom'
  | 'validate_geometry'
  | 'click'
  | 'type_text'
  | 'keypress'
  | 'scroll'
  | 'drag'
  | 'move_mouse'
  | 'overlay_set_enabled'
  | 'overlay_show_target'
  | 'overlay_cursor'
  /** Suspend/resume software cursor around screenshots (keeps tip state). */
  | 'overlay_cursor_visible'
  | 'overlay_hide'
  | 'terminate'

export interface HelperRequest {
  id: string
  method: HelperMethod | string
  params?: Record<string, unknown>
}

export interface HelperResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

/**
 * Helper → host push. Distinguished from a response purely by shape: events
 * carry `event` and no `id`, because the request/response protocol gives the
 * helper no other way to speak first.
 */
export interface HelperEvent {
  event: string
  [key: string]: unknown
}

/** User picked Stop in the helper's status menu. */
export interface HelperStopRequestedEvent extends HelperEvent {
  event: 'computer_use_stop_requested'
  scope: 'current_turn'
  sessionIds: string[]
}

export function isHelperEvent(value: unknown): value is HelperEvent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.event === 'string' && v.id === undefined
}

export interface HelperDoctor {
  accessibility: 'granted' | 'missing' | string
  screenRecording: 'granted' | 'missing' | string
  bundleId: string
  bundlePath: string
  pid: number
  /**
   * Combined grant is true but process preflight still denied — host should
   * relaunch the helper once so ScreenCaptureKit can use the new TCC state.
   */
  screenRecordingNeedsRelaunch: boolean
  /** Optional runtime-only probe (CGPreflight / AX); diagnostics only. */
  accessibilityRuntime?: 'granted' | 'missing' | string
  screenRecordingRuntime?: 'granted' | 'missing' | string
  /** Best-effort TCC.db diagnostics; never sufficient to report usable access. */
  accessibilityPersisted?: 'granted' | 'missing' | string
  screenRecordingPersisted?: 'granted' | 'missing' | string
}

export interface HelperAppInfo {
  app: string
  bundleId: string
  pid: number
  frontmost: boolean
}

export interface HelperWindowInfo {
  app: string
  bundleId: string
  pid: number
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  focused: boolean
  visible: boolean
  minimized: boolean
  modal: boolean
  kind: string
  resourceKey: string
  /** CGWindowNumber for z-order relative placement of overlays. */
  windowId?: number
  /** Helper-owned identity for AX-only transient roots. */
  axRootId?: string
  /** kCGWindowLayer (0 = normal). */
  windowLayer?: number
}

export interface HelperCaptureResult {
  mimeType: 'image/png' | string
  data: string
  width: number
  height: number
  coordinateSpace: {
    width: number
    height: number
    scale: number
    fullScreen: boolean
    kind?: 'window' | 'display'
    windowId?: number
    axRootId?: string
    capturedBounds?: { x: number; y: number; width: number; height: number }
    displayBounds?: { x: number; y: number; width: number; height: number }
  }
  grantedBundleIds?: string[]
  excludedAppCount?: number
}

/** Nested AX node from helper `ax_tree` (DFS `index` is 1-based). */
export interface HelperAxNode {
  index: number
  role: string
  name?: string
  value?: string
  bounds?: { x: number; y: number; width: number; height: number }
  enabled?: boolean
  focused?: boolean
  settable?: boolean
  actions?: string[]
  children?: HelperAxNode[]
}

export interface HelperAxTreeResult {
  tree: HelperAxNode
  nodeCount: number
  maxNodes: number
  maxDepth: number
  display: { width: number; height: number }
  pid: number
}

export interface HelperAxActionResult {
  ok: boolean
  requestedIndex?: number
  index: number
  recovered?: boolean
  action: string
  role?: string
  beforeValue?: string
  afterValue?: string
  beforeName?: string
  afterName?: string
  value?: string
}
