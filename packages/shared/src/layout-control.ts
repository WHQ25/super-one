/**
 * Desktop layout control shared by the `layout_snapshot` / `layout_act` agent tools and
 * the mini-app Node Host's `context.layout`. One renderer implementation answers
 * both; see docs/features/layout-control.md.
 */

export const LAYOUT_ACT_ACTIONS = [
  'open_file',
  'focus_tab',
  'close_tab',
  'move_tab',
  'resize_group',
  'show_panel',
  'hide_panel',
  'maximize_panel',
  'restore_panel',
  'panel_side',
  'show_sidebar',
  'hide_sidebar',
  'resize_sidebar',
  'resize_panel',
  'chat_mode',
  'show_terminal',
  'hide_terminal',
  'split_session',
  'close_split',
] as const

export type LayoutActAction = (typeof LAYOUT_ACT_ACTIONS)[number]

/**
 * move_tab: beside a group (a new group on that side) or `into` it. split_session
 * takes the four sides.
 */
export const LAYOUT_DIRECTIONS = ['right', 'down', 'left', 'up', 'into'] as const

export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number]

/**
 * How the caller's chat is shown: a column beside the activity panel, or — while the
 * panel fills the window — a floating window over it, or that window collapsed to an icon.
 */
export const LAYOUT_CHAT_MODES = ['docked', 'floating', 'icon'] as const

export type LayoutChatMode = (typeof LAYOUT_CHAT_MODES)[number]

/** Where the floating chat (or its icon) snaps: the corners and edge midpoints of the window. */
export const LAYOUT_CHAT_POSITIONS = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'] as const

export type LayoutChatPosition = (typeof LAYOUT_CHAT_POSITIONS)[number]

export interface LayoutActRequest {
  action: LayoutActAction
  /** open_file: the file. */
  path?: string
  /** open_file: 1-based line to reveal. */
  line?: number
  /** focus_tab / close_tab / move_tab / maximize_panel: a tab id from the snapshot. */
  tab?: string
  /** move_tab / resize_group: a group index from the snapshot. move_tab defaults to the tab's own group. */
  group?: number
  /** move_tab / split_session. Default right. */
  direction?: LayoutDirection
  /** move_tab: 0-based position among the destination group's tabs. */
  index?: number
  /** panel_side. */
  side?: 'left' | 'right'
  /** split_session / close_split: a session the caller launched. */
  sessionId?: string
  /** resize_sidebar / resize_panel / resize_group: target width in px, clamped to the snapshot's `sizes` range. */
  width?: number
  /** resize_group: target height in px. */
  height?: number
  /** chat_mode. */
  mode?: LayoutChatMode
  /** chat_mode: where the floating chat snaps. Kept while docked for the next float. */
  position?: LayoutChatPosition
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
  /** resize_sidebar / resize_panel / resize_group: the size applied after clamping. */
  width?: number
  height?: number
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

/** A tab group of the activity panel: px box inside the panel, origin top-left. */
export interface LayoutGroup {
  group: number
  x: number
  y: number
  width: number
  height: number
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
  chatMode: LayoutChatMode
  /** Where the floating chat snaps; remembered while docked. */
  chatPosition: LayoutChatPosition
  /** Window-wide widths in px. Each range holds the other columns at their current width. */
  sizes: LayoutSizes
  /** The panel's tab groups in on-screen order; a tab's `group` indexes this. */
  groups: LayoutGroup[]
  tabs: LayoutTab[]
  /** Mini-app callers: the tab that shows the app itself, when it is open. */
  self?: string
}

export interface LayoutWidthRange {
  width: number
  min: number
  max: number
}

/**
 * The window is split into sidebar | chat | activity panel. The chat takes what the
 * others leave, so narrowing it means widening the sidebar or the panel.
 */
export interface LayoutSizes {
  window: number
  /** Width while expanded; it keeps its width when collapsed. */
  sidebar: LayoutWidthRange
  /** Width while open and not maximized. */
  panel: LayoutWidthRange
  /** 0 while the panel is maximized over it. */
  chat: { width: number; min: number }
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

/**
 * Where a tab the agent just opened is shown. Agent openers never take the user's
 * focus, so unless the caller's activity panel is on screen the tab lands in the
 * background — drawn as a picture-in-picture over the chat for kinds that have one.
 */
export type OpenedTabPresentation = 'panel' | 'pip' | 'background'

/** What an open result adds when the user cannot see the tab in the panel. */
export interface OpenedTabNote {
  shown: Exclude<OpenedTabPresentation, 'panel'>
  reveal: string
}

/** `bringForward` is the layout_act call that puts the tab in front, e.g. focus_tab with its id. */
export function openedTabNote(presentation: OpenedTabPresentation, bringForward: string): OpenedTabNote | null {
  if (presentation === 'panel') return null
  const where = presentation === 'pip'
    ? 'Opened in the background: the user sees it only as a small picture-in-picture over the chat.'
    : 'Opened in the background: the user cannot see it now.'
  return { shown: presentation, reveal: `${where} If they want it in front, call ${bringForward}.` }
}

export function focusTabCall(tab: string): string {
  return `layout_act action=focus_tab tab="${tab}"`
}
