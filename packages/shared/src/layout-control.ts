/**
 * Desktop layout control shared by the `layout_snapshot` / `layout_act` agent tools and
 * the mini-app Node Host's `context.layout`. One renderer implementation answers
 * both; see docs/features/layout-control.md.
 */

export const LAYOUT_ACT_ACTIONS = [
  'open_file',
  'focus_tab',
  'close_tab',
  'split_tab',
  'show_panel',
  'hide_panel',
  'maximize_panel',
  'restore_panel',
  'panel_side',
  'show_sidebar',
  'hide_sidebar',
  'show_terminal',
  'hide_terminal',
  'split_session',
  'close_split',
] as const

export type LayoutActAction = (typeof LAYOUT_ACT_ACTIONS)[number]

export interface LayoutActRequest {
  action: LayoutActAction
  /** open_file: the file. */
  path?: string
  /** open_file: 1-based line to reveal. */
  line?: number
  /** focus_tab / close_tab / split_tab / maximize_panel: a tab id from the snapshot. */
  tab?: string
  /** split_tab / split_session. Default right. */
  direction?: 'right' | 'down'
  /** panel_side. */
  side?: 'left' | 'right'
  /** split_session / close_split: a session the caller launched. */
  sessionId?: string
}

/**
 * - `applied`: done in the layout on screen; `visible` says whether the user can see it now.
 * - `queued`: written into the caller's own layout, shown when the user next opens that session.
 * - `skipped`: window-wide change refused because the caller is not on screen (it must not steal focus).
 */
export type LayoutActStatus = 'applied' | 'queued' | 'skipped'

export interface LayoutActResult {
  status: LayoutActStatus
  visible: boolean
  /** The tab the action opened or targeted. */
  tab?: string
  /** Why a `skipped` action did nothing. */
  reason?: 'not_visible'
}

export type LayoutTabKind =
  | 'file'
  | 'browser'
  | 'terminal'
  | 'miniapp'
  | 'device'
  | 'side-chat'
  | 'trajectory'
  | 'tool-preview'
  | 'mcp-app'
  | 'mod-pane'
  | 'other'

export type LayoutTabOpener = 'agent' | 'miniapp' | 'user'

export interface LayoutTab {
  tab: string
  kind: LayoutTabKind
  title: string
  /** The focused tab of the panel. */
  active: boolean
  /** Split group index, 0-based in layout order. */
  group: number
  openedBy: LayoutTabOpener
}

export interface LayoutSnapshot {
  /** The caller's chat is on screen (foreground or a split pane) and the window is visible. */
  visible: boolean
  window: {
    visible: boolean
    sidebar: 'expanded' | 'collapsed'
    layout: 'single' | 'split'
    /** Sessions shown side by side, when layout is split. */
    splitSessions?: string[]
  }
  /** The caller's own activity panel. */
  panel: {
    open: boolean
    /** Drawn on screen right now (open, caller in front, not hidden by the split view). */
    onScreen: boolean
    side: 'left' | 'right'
    maximized: boolean
  }
  /** The caller's bottom terminal panel. */
  terminal: { open: boolean }
  tabs: LayoutTab[]
  /** Mini-app callers: the tab that shows the app itself, when it is open. */
  self?: string
}

/** Who is asking. The opener decides which tabs and panes the caller may close. */
export interface LayoutControlCaller {
  sessionId: string
  opener: { kind: 'agent' } | { kind: 'miniapp'; appId: string; instanceKey?: string }
  /** The caller's working folder: relative file paths resolve against it. */
  root?: string
}

export type LayoutControlErrorCode = 'invalid' | 'not_found' | 'not_owned' | 'not_child' | 'unavailable'

export class LayoutControlError extends Error {
  constructor(readonly code: LayoutControlErrorCode, message: string) {
    super(message)
    this.name = 'LayoutControlError'
  }
}
