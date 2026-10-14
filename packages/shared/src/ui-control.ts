/**
 * Desktop layout control shared by the `ui_snapshot` / `ui_act` agent tools and
 * the mini-app Node Host's `context.layout`. One renderer implementation answers
 * both; see docs/features/ui-control.md.
 */

export const UI_ACT_ACTIONS = [
  'open_file',
  'open_diff',
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

export type UiActAction = (typeof UI_ACT_ACTIONS)[number]

export interface UiActRequest {
  action: UiActAction
  /** open_file: the file. open_diff: limit the diff to this file. */
  path?: string
  /** open_file: 1-based line to reveal. */
  line?: number
  /** open_diff: commit sha or ref; omitted for uncommitted changes. */
  commit?: string
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
export type UiActStatus = 'applied' | 'queued' | 'skipped'

export interface UiActResult {
  status: UiActStatus
  visible: boolean
  /** The tab the action opened or targeted. */
  tab?: string
  /** Why a `skipped` action did nothing. */
  reason?: 'not_visible'
}

export type UiTabKind =
  | 'file'
  | 'diff'
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

export type UiTabOpener = 'agent' | 'miniapp' | 'user'

export interface UiTab {
  tab: string
  kind: UiTabKind
  title: string
  /** The focused tab of the panel. */
  active: boolean
  /** Split group index, 0-based in layout order. */
  group: number
  openedBy: UiTabOpener
}

export interface UiSnapshot {
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
  tabs: UiTab[]
  /** Mini-app callers: the tab that shows the app itself, when it is open. */
  self?: string
}

/** Who is asking. The opener decides which tabs and panes the caller may close. */
export interface UiControlCaller {
  sessionId: string
  opener: { kind: 'agent' } | { kind: 'miniapp'; appId: string; instanceKey?: string }
  /** The caller's working folder: relative paths and diffs resolve against it. */
  root?: string
}

export type UiControlErrorCode = 'invalid' | 'not_found' | 'not_owned' | 'not_child' | 'unavailable'

export class UiControlError extends Error {
  constructor(readonly code: UiControlErrorCode, message: string) {
    super(message)
    this.name = 'UiControlError'
  }
}
