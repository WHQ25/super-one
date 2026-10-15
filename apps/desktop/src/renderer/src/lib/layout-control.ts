import type { SerializedDockview } from 'dockview-core'
import {
  LAYOUT_CHAT_MODES,
  LAYOUT_CHAT_POSITIONS,
  LAYOUT_DIRECTIONS,
  LayoutControlError,
  type LayoutActRequest,
  type LayoutActResult,
  type LayoutChatMode,
  type LayoutChatPosition,
  type LayoutControlCaller,
  type LayoutDirection,
  type LayoutGroup,
  type LayoutSizes,
  type LayoutSnapshot,
  type LayoutTab,
  type LayoutTabKind,
} from '@superone/shared/layout-control'
import {
  closeActivityTab,
  dockSessionId,
  focusActivityTab,
  getDockApi,
  groupsInLayoutOrder,
  isDockReady,
  maximizeActivityTab,
  moveActivityTab,
  openNewFileTab,
  restoreActivityPanel,
} from '@/components/activity/activity-panel-api'
import {
  dockOpener,
  forgetDockOpener,
  queueDockChange,
  queuedDockChanges,
  recordDockOpener,
  type DockOpener,
  type QueuedDockChange,
} from '@/components/activity/dock-ownership'
import { mosaicTileId, useMosaicStore } from '@/components/mosaic/mosaic-store'
import { collectLeaves, measureMin, type DropEdge } from '@/components/mosaic/mosaic-tree'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useAppStore } from '@/stores/app'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { findSessionTarget } from '@/stores/chat-store/helpers/store-helpers'
import type { Corner } from '@/stores/chat-store/types'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useSourceControlStore } from '@/stores/source-control'
import { useTerminalStore } from '@/stores/terminal'
import { selectPanelsFolded, useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { normalizeFileLinkTarget, toProjectRelativePath } from '@/lib/file-link'
import { setActivityPanelShown, setChatFloating, toggleActivitySide, toggleSidebar } from '@/lib/layout-actions'
import { LAYOUT, maxPanelWidth, maxSidebarWidth } from '@/lib/layout-constants'

/**
 * The single implementation behind `layout_snapshot` / `layout_act` and a mini-app's
 * `context.layout`. Contract and rules: docs/features/layout-control.md.
 *
 * Every call is scoped to the caller's session. Its own layout (activity panel,
 * tabs, bottom terminal) is changed even when the user is looking elsewhere —
 * a parked layout takes the change when it is next shown. Window-wide state
 * (sidebar, panel side, split view) changes only while the caller is on screen.
 */

const COMPONENT_KINDS: Record<string, LayoutTabKind> = {
  'file-preview': 'file',
  browser: 'browser',
  terminal: 'terminal',
  miniapp: 'miniapp',
  device: 'device',
  'side-chat': 'side-chat',
  trajectory: 'trajectory',
  'miniapp-tool-preview': 'tool-preview',
  'mcp-app': 'mcp-app',
  'mod-pane': 'mod-pane',
}

function kindOf(component: string | undefined): LayoutTabKind {
  return (component && COMPONENT_KINDS[component]) || 'other'
}

function openerKey(caller: LayoutControlCaller): DockOpener {
  return caller.opener.kind === 'agent' ? 'agent' : `miniapp:${caller.opener.appId}`
}

function splitKey(sessionId: string): string {
  return `split:${sessionId}`
}

interface Placement {
  split: boolean
  splitSessions: string[]
  windowVisible: boolean
  /** The caller's chat is drawn: the foreground session, or one of the split panes. */
  chatOnScreen: boolean
  /** The live dock holds the caller's layout (not parked, not hidden by the split view). */
  dockLive: boolean
}

function placement(sessionId: string): Placement {
  const mosaic = useMosaicStore.getState()
  const split = mosaic.mode === 'mosaic' && mosaic.root !== null
  const splitSessions = split && mosaic.root ? collectLeaves(mosaic.root).map((leaf) => leaf.sessionId) : []
  const mainView = useAppStore.getState().view === 'main'
  const foreground = split ? splitSessions.includes(sessionId) : selectActiveChatSessionId(useChatStore.getState()) === sessionId
  return {
    split,
    splitSessions,
    windowVisible: document.visibilityState === 'visible',
    chatOnScreen: mainView && foreground,
    dockLive: !split && isDockReady() && dockSessionId() === sessionId,
  }
}

function panelOnScreen(sessionId: string): boolean {
  const p = placement(sessionId)
  return p.dockLive && p.chatOnScreen && p.windowVisible
    && useActivityPanelStore.getState().showPanel
    && !selectPanelsFolded(useWindowMiniModeStore.getState())
}

/** The chat area's floor: one chat, or the split view's measured minimum. */
function chatMinWidth(): number {
  const mosaic = useMosaicStore.getState()
  const tiles = mosaic.mode === 'mosaic' && mosaic.root ? measureMin(mosaic.root).w : 0
  return Math.max(LAYOUT.MIN_MAIN, tiles)
}

/** The same bounds the resize sashes and the window-resize clamp in App.tsx enforce. */
function layoutSizes(): LayoutSizes {
  const { showSidebar, sidebarWidth } = useAppStore.getState()
  const ap = useActivityPanelStore.getState()
  const windowWidth = window.innerWidth
  const chatMin = chatMinWidth()
  const sidebarReserved = showSidebar ? sidebarWidth : 0
  const fills = ap.showPanel && selectPanelFillsWindow(ap)
  const panelReserved = ap.showPanel && !fills ? ap.panelWidth : 0
  return {
    window: windowWidth,
    sidebar: {
      width: sidebarWidth,
      min: LAYOUT.MIN_SIDEBAR,
      max: Math.max(LAYOUT.MIN_SIDEBAR, maxSidebarWidth(windowWidth, fills ? LAYOUT.MIN_AP : chatMin, panelReserved)),
    },
    panel: {
      width: ap.panelWidth,
      min: LAYOUT.MIN_AP,
      max: Math.max(LAYOUT.MIN_AP, maxPanelWidth(windowWidth, sidebarReserved, chatMin)),
    },
    chat: {
      width: fills ? 0 : Math.max(0, windowWidth - sidebarReserved - panelReserved - LAYOUT.CARD_GUTTER),
      min: chatMin,
    },
  }
}

/** A panel filling the window turns the chat into a floating window, collapsed to an icon when closed. */
function chatMode(sessionId: string): LayoutChatMode {
  if (!placement(sessionId).dockLive || !selectPanelFillsWindow(useActivityPanelStore.getState())) return 'docked'
  return useChatStore.getState().isOpen ? 'floating' : 'icon'
}

/** The floating chat's snap anchors (`ChatPanel`), named for the agent. */
const CHAT_ANCHORS: Record<LayoutChatPosition, Corner> = {
  'top-left': 'tl',
  top: 'tm',
  'top-right': 'tr',
  right: 'rm',
  'bottom-right': 'br',
  bottom: 'bm',
  'bottom-left': 'bl',
  left: 'lm',
}

function chatPosition(): LayoutChatPosition {
  const corner = useChatStore.getState().corner
  return LAYOUT_CHAT_POSITIONS.find((position) => CHAT_ANCHORS[position] === corner) ?? 'bottom-right'
}

/** Mode, position, or both; an omitted one stays as it is. */
function setChatMode(sessionId: string, request: LayoutActRequest): LayoutActResult {
  const { mode, position } = request
  if (mode === undefined && position === undefined) invalid('chat_mode needs mode, position, or both.')
  if (mode !== undefined && !(LAYOUT_CHAT_MODES as readonly unknown[]).includes(mode)) invalid('mode must be "docked", "floating" or "icon".')
  if (position !== undefined && !(position in CHAT_ANCHORS)) invalid(`position must be one of ${LAYOUT_CHAT_POSITIONS.join(', ')}.`)
  const p = placement(sessionId)
  if (!p.chatOnScreen) return skipped()
  if (!p.dockLive) throw new LayoutControlError('unavailable', 'The split view shows chats side by side; the chat mode applies once it is closed.')
  if (position) useChatStore.getState().setCorner(CHAT_ANCHORS[position])
  if (mode) {
    setChatFloating(mode !== 'docked')
    if (mode === 'icon') useChatStore.setState({ isOpen: false })
  }
  // A position alone, while docked, waits for the next float.
  return { status: 'applied', visible: p.windowVisible && (mode !== undefined || chatMode(sessionId) !== 'docked') }
}

function clampWidth(width: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(width)))
}

const TERMINAL_PANEL_PREFIX = 'terminal-'

/** terminal_tabs names a terminal by its bare id, so the snapshot does too. */
function publicTabId(panelId: string): string {
  return panelId.startsWith(TERMINAL_PANEL_PREFIX) ? panelId.slice(TERMINAL_PANEL_PREFIX.length) : panelId
}

function openedBy(sessionId: string, tab: string): LayoutTab['openedBy'] {
  const opener = dockOpener(sessionId, tab)
  if (opener === null) return 'user'
  return opener === 'agent' ? 'agent' : 'miniapp'
}

/** A snapshot row plus the dock panel id it stands for. */
type TabRow = LayoutTab & { panelId: string }

function liveTabs(sessionId: string): TabRow[] {
  const api = getDockApi()
  if (!api) return []
  const groupIndex = new Map(groupsInLayoutOrder().map((group, index) => [group.id, index]))
  return api.panels.map((panel) => ({
    tab: publicTabId(panel.id),
    panelId: panel.id,
    kind: kindOf(panel.view.contentComponent),
    title: panel.title ?? '',
    active: api.activePanel?.id === panel.id,
    group: groupIndex.get(panel.group.id) ?? 0,
    openedBy: openedBy(sessionId, panel.id),
  }))
}

type GridNode = { type: 'leaf' | 'branch'; data: unknown; size: number }
interface GroupState { id: string; views: string[]; activeView?: string }
type SerializedGrid = SerializedDockview['grid']
type GridGroup = Omit<LayoutGroup, 'group'> & { state: GroupState }

/**
 * The grid's groups in on-screen order with their px box. A branch lays its children
 * along its axis, each `size` long; nesting alternates the axis from the root's.
 */
function gridGroups(grid: SerializedGrid | undefined): GridGroup[] {
  const out: GridGroup[] = []
  const walk = (node: GridNode, horizontal: boolean, x: number, y: number, width: number, height: number): void => {
    if (node.type === 'leaf') {
      out.push({ state: node.data as GroupState, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
      return
    }
    let offset = 0
    for (const child of node.data as GridNode[]) {
      if (horizontal) walk(child, false, x + offset, y, child.size, height)
      else walk(child, true, x, y + offset, width, child.size)
      offset += child.size
    }
  }
  if (grid) walk(grid.root as GridNode, grid.orientation === 'HORIZONTAL', 0, 0, grid.width, grid.height)
  return out
}

function parkedLayout(sessionId: string): SerializedDockview | null {
  return (useActivityViewStateStore.getState().perSession[sessionId]?.layout as SerializedDockview | null | undefined) ?? null
}

/** The caller's tab groups as the snapshot reports them; tab `group` indices point here. */
function sessionGroups(sessionId: string): LayoutGroup[] {
  const grid = placement(sessionId).dockLive ? getDockApi()?.toJSON().grid : parkedLayout(sessionId)?.grid
  return gridGroups(grid).map(({ state: _state, ...box }, group) => ({ group, ...box }))
}

/** A parked session's tabs: its saved layout, the browser tabs it will materialize, then its queued changes. */
function parkedTabs(sessionId: string): TabRow[] {
  const layout = parkedLayout(sessionId)
  const tabs: TabRow[] = []
  if (layout) {
    for (const [index, { state: group }] of gridGroups(layout.grid).entries()) {
      for (const view of group.views) {
        const panel = layout.panels[view]
        tabs.push({
          tab: publicTabId(view),
          panelId: view,
          kind: kindOf(panel?.contentComponent),
          title: panel?.title ?? '',
          active: layout.activeGroup === group.id && group.activeView === view,
          group: index,
          openedBy: openedBy(sessionId, view),
        })
      }
    }
  }
  for (const [id, browserTab] of Object.entries(useBrowserStore.getState().tabs)) {
    if (browserTab.owner !== sessionId || tabs.some((t) => t.tab === id)) continue
    tabs.push({ tab: id, panelId: id, kind: 'browser', title: browserTab.title, active: false, group: 0, openedBy: openedBy(sessionId, id) })
  }
  for (const change of queuedDockChanges(sessionId)) {
    if (change.kind === 'open' && change.tab && change.preview && !tabs.some((t) => t.panelId === change.tab)) {
      tabs.push({ tab: publicTabId(change.tab), panelId: change.tab, kind: change.preview.kind as LayoutTabKind, title: change.preview.title, active: false, group: 0, openedBy: openedBy(sessionId, change.tab) })
    } else if (change.kind === 'close' && change.tab) {
      const at = tabs.findIndex((t) => t.panelId === change.tab)
      if (at >= 0) tabs.splice(at, 1)
    }
  }
  return tabs
}

function sessionTabs(sessionId: string): TabRow[] {
  return placement(sessionId).dockLive ? liveTabs(sessionId) : parkedTabs(sessionId)
}

/** The session's working folder: its worktree when it has one. */
function sessionRoot(caller: LayoutControlCaller): string | null {
  if (caller.root) return caller.root
  const chat = useChatStore.getState()
  const target = findSessionTarget(chat, caller.sessionId)
  if (!target) return null
  return chat.projectSessions[target.projectPath]?._sessions[target.sessionId]?._worktreePath ?? target.projectPath
}

export function layoutSnapshot(caller: LayoutControlCaller): LayoutSnapshot {
  const sid = caller.sessionId
  const p = placement(sid)
  const ap = useActivityPanelStore.getState()
  const parked = useActivityViewStateStore.getState().perSession[sid]
  const tabs = (p.dockLive ? liveTabs(sid) : parkedTabs(sid)).map(({ panelId: _panelId, ...tab }) => tab)
  const selfTab = caller.opener.kind === 'miniapp' && caller.opener.instanceKey ? `miniapp-${caller.opener.instanceKey}` : undefined
  return {
    visible: p.chatOnScreen && p.windowVisible,
    window: {
      visible: p.windowVisible,
      sidebar: useAppStore.getState().showSidebar ? 'expanded' : 'collapsed',
      layout: p.split ? 'split' : 'single',
      ...(p.split ? { splitSessions: p.splitSessions } : {}),
    },
    panel: {
      open: p.dockLive ? ap.showPanel : (parked?.showPanel ?? false),
      onScreen: panelOnScreen(sid),
      side: ap.side,
      maximized: p.dockLive && ap.maximized,
    },
    terminal: { open: useTerminalStore.getState().openBySession[sid] ?? false },
    chatMode: chatMode(sid),
    chatPosition: chatPosition(),
    sizes: layoutSizes(),
    groups: sessionGroups(sid),
    tabs,
    ...(selfTab && tabs.some((t) => t.tab === selfTab) ? { self: selfTab } : {}),
  }
}

function invalid(message: string): never {
  throw new LayoutControlError('invalid', message)
}

/** The dock panel id behind a tab id from the snapshot (or a terminal_tabs / browser_tabs id). */
function requireTab(sessionId: string, tab: string | undefined): string {
  if (!tab) invalid('tab is required. Use a tab id from layout_snapshot.')
  const row = sessionTabs(sessionId).find((t) => t.tab === tab || t.panelId === tab)
  if (!row) throw new LayoutControlError('not_found', `No tab ${tab} in this session's layout. Call layout_snapshot for current tab ids.`)
  return row.panelId
}

/** A group index from the snapshot, checked against the caller's layout. */
function requireGroup(sessionId: string, group: number | undefined): number {
  if (group === undefined) invalid('group is required. Use a group index from layout_snapshot.')
  const count = placement(sessionId).dockLive ? groupsInLayoutOrder().length : sessionGroups(sessionId).length
  if (!Number.isInteger(group) || group < 0 || group >= count) {
    throw new LayoutControlError('not_found', `No group ${group} in this session's layout. Call layout_snapshot for current groups.`)
  }
  return group
}

/** The live group behind an index, when a queued change finally runs. */
function liveGroup(group: number) {
  const target = groupsInLayoutOrder()[group]
  if (!target) throw new LayoutControlError('not_found', `No group ${group} in this session's layout. Call layout_snapshot for current groups.`)
  return target
}

/** Apply a dock change now when the caller's layout is live, otherwise park it with that layout. */
function dockChange(sessionId: string, change: QueuedDockChange): LayoutActResult {
  if (placement(sessionId).dockLive) {
    change.run()
    return { status: 'applied', visible: panelOnScreen(sessionId), ...(change.tab ? { tab: publicTabId(change.tab) } : {}) }
  }
  queueDockChange(sessionId, change)
  return { status: 'queued', visible: false, ...(change.tab ? { tab: publicTabId(change.tab) } : {}) }
}

function skipped(): LayoutActResult {
  return { status: 'skipped', visible: false, reason: 'not_visible' }
}

/** Open a tab and record who opened it — unless it is already there, in which case it stays the user's. */
function openTab(caller: LayoutControlCaller, tab: string, preview: { kind: LayoutTabKind; title: string }, run: () => void): LayoutActResult {
  const sid = caller.sessionId
  if (!sessionTabs(sid).some((t) => t.panelId === tab)) recordDockOpener(sid, tab, openerKey(caller))
  return dockChange(sid, { kind: 'open', tab, preview, run })
}

export async function layoutAct(caller: LayoutControlCaller, request: LayoutActRequest): Promise<LayoutActResult> {
  const sid = caller.sessionId
  switch (request.action) {
    case 'open_file': {
      if (!request.path) invalid('path is required for open_file.')
      if (request.line !== undefined && (!Number.isInteger(request.line) || request.line < 1)) invalid('line must be a positive integer.')
      const root = sessionRoot(caller)
      const openPath = root ? toProjectRelativePath(request.path, root) : request.path
      const tab = `file:${normalizeFileLinkTarget(openPath)}`
      return openTab(caller, tab, { kind: 'file', title: openPath.split('/').pop() ?? openPath }, () => {
        if (root) void useSourceControlStore.getState().selectFile(root, openPath, request.line)
        openNewFileTab(openPath)
      })
    }
    case 'focus_tab': {
      const tab = requireTab(sid, request.tab)
      return dockChange(sid, { kind: 'focus', tab, run: () => { focusActivityTab(tab) } })
    }
    case 'move_tab': {
      const tab = requireTab(sid, request.tab)
      const direction = request.direction ?? 'right'
      if (!(LAYOUT_DIRECTIONS as readonly unknown[]).includes(direction)) invalid(`direction must be one of ${LAYOUT_DIRECTIONS.join(', ')}.`)
      const { index } = request
      if (index !== undefined && (!Number.isInteger(index) || index < 0)) invalid('index must be a non-negative integer.')
      const group = request.group === undefined ? undefined : requireGroup(sid, request.group)
      return dockChange(sid, {
        kind: 'move',
        tab,
        run: () => {
          const target = group === undefined ? undefined : liveGroup(group)
          if (!moveActivityTab(tab, { group: target, direction, index })) {
            invalid(`Tab ${request.tab} is the only one in your activity panel; there is nothing to put it beside.`)
          }
        },
      })
    }
    case 'resize_group': {
      const { width, height } = request
      if (width === undefined && height === undefined) invalid('resize_group needs width, height, or both.')
      for (const size of [width, height]) {
        if (size !== undefined && (typeof size !== 'number' || !Number.isFinite(size) || size <= 0)) invalid('width and height are positive px.')
      }
      const group = requireGroup(sid, request.group)
      const size = { ...(width !== undefined ? { width: Math.round(width) } : {}), ...(height !== undefined ? { height: Math.round(height) } : {}) }
      const result = dockChange(sid, { kind: 'resize', run: () => { liveGroup(group).api.setSize(size) } })
      if (result.status !== 'applied') return result
      // Its neighbours' minimums clamp the request; report what it got.
      const applied = liveGroup(group).api
      return { ...result, width: Math.round(applied.width), height: Math.round(applied.height) }
    }
    case 'close_tab': {
      const tab = requireTab(sid, request.tab)
      if (dockOpener(sid, tab) !== openerKey(caller)) {
        throw new LayoutControlError('not_owned', `Tab ${tab} was not opened by you; only tabs you opened can be closed.`)
      }
      return dockChange(sid, {
        kind: 'close',
        tab,
        run: () => {
          closeActivityTab(tab)
          forgetDockOpener(sid, tab)
        },
      })
    }
    case 'maximize_panel': {
      const tab = request.tab ? requireTab(sid, request.tab) : undefined
      return dockChange(sid, { kind: 'maximize', ...(tab ? { tab } : {}), run: () => { maximizeActivityTab(tab) } })
    }
    case 'restore_panel':
      return dockChange(sid, { kind: 'restore', run: restoreActivityPanel })
    case 'show_panel':
    case 'hide_panel': {
      const show = request.action === 'show_panel'
      const p = placement(sid)
      if (p.dockLive) {
        setActivityPanelShown(show)
        return { status: 'applied', visible: show ? panelOnScreen(sid) : p.chatOnScreen && p.windowVisible }
      }
      useActivityViewStateStore.getState().setParkedShowPanel(sid, show)
      return { status: 'queued', visible: false }
    }
    case 'show_terminal':
    case 'hide_terminal': {
      useTerminalStore.getState().setOpen(sid, request.action === 'show_terminal')
      const p = placement(sid)
      // The split view draws chats only; a terminal opened there shows once the session is single again.
      const shown = p.chatOnScreen && !p.split
      return { status: shown ? 'applied' : 'queued', visible: shown && p.windowVisible }
    }
    case 'panel_side': {
      if (request.side !== 'left' && request.side !== 'right') invalid('side must be "left" or "right".')
      const p = placement(sid)
      if (!p.chatOnScreen) return skipped()
      if (useActivityPanelStore.getState().side !== request.side) toggleActivitySide()
      return { status: 'applied', visible: panelOnScreen(sid) }
    }
    case 'show_sidebar':
    case 'hide_sidebar': {
      const p = placement(sid)
      if (!p.chatOnScreen) return skipped()
      if (useAppStore.getState().showSidebar !== (request.action === 'show_sidebar')) toggleSidebar()
      return { status: 'applied', visible: p.windowVisible }
    }
    case 'resize_sidebar':
    case 'resize_panel': {
      if (typeof request.width !== 'number' || !Number.isFinite(request.width)) invalid(`width (px) is required for ${request.action}.`)
      const p = placement(sid)
      if (!p.chatOnScreen) return skipped()
      const sizes = layoutSizes()
      if (request.action === 'resize_sidebar') {
        const width = clampWidth(request.width, sizes.sidebar)
        useAppStore.getState().setSidebarWidth(width)
        return { status: 'applied', visible: p.windowVisible && useAppStore.getState().showSidebar, width }
      }
      const width = clampWidth(request.width, sizes.panel)
      // As if the user dragged the sash, so the next open keeps this width instead of filling the window.
      useActivityPanelStore.getState().setPanelWidthByUser(width)
      return { status: 'applied', visible: panelOnScreen(sid) && !selectPanelFillsWindow(useActivityPanelStore.getState()), width }
    }
    case 'chat_mode':
      return setChatMode(sid, request)
    case 'split_session':
      return splitSession(caller, request)
    case 'close_split': {
      const child = request.sessionId
      if (!child) invalid('sessionId is required for close_split.')
      const p = placement(sid)
      if (!p.chatOnScreen) return skipped()
      const root = useMosaicStore.getState().root
      const leaf = root ? collectLeaves(root).find((candidate) => candidate.sessionId === child) : undefined
      if (!leaf) throw new LayoutControlError('not_found', `Session ${child} is not in the split view.`)
      if (dockOpener(sid, splitKey(child)) !== openerKey(caller)) {
        throw new LayoutControlError('not_owned', `The pane for ${child} was not added by you; only panes you added can be closed.`)
      }
      useMosaicStore.getState().removeTile(leaf.id)
      forgetDockOpener(sid, splitKey(child))
      return { status: 'applied', visible: p.windowVisible }
    }
    default:
      return invalid(`Unknown action: ${String((request as { action?: unknown }).action)}`)
  }
}

const SESSION_EDGES: Record<Exclude<LayoutDirection, 'into'>, DropEdge> = { right: 'right', down: 'bottom', left: 'left', up: 'top' }

async function splitSession(caller: LayoutControlCaller, request: LayoutActRequest): Promise<LayoutActResult> {
  const sid = caller.sessionId
  const child = request.sessionId
  if (!child) invalid('sessionId is required for split_session.')
  const direction = request.direction ?? 'right'
  if (direction === 'into' || !(direction in SESSION_EDGES)) invalid('direction must be right, down, left or up for split_session.')
  if (child === sid) invalid('sessionId must be a session you launched, not your own.')
  if (!placement(sid).chatOnScreen) return skipped()
  const childProject = await window.app.getSpawnedSessionProject(sid, child)
  if (!childProject) throw new LayoutControlError('not_child', `Session ${child} was not launched by this session. Only sessions you started with session_collab_* can be split in.`)
  // The await gave the user time to move on; re-check before touching the window.
  const p = placement(sid)
  if (!p.chatOnScreen) return skipped()
  const mosaic = useMosaicStore.getState()
  if (p.splitSessions.includes(child)) return { status: 'applied', visible: p.windowVisible }
  const chat = useChatStore.getState()
  const projectPath = findSessionTarget(chat, child)?.projectPath ?? childProject
  const callerTile = p.split && mosaic.root
    ? collectLeaves(mosaic.root).find((leaf) => leaf.sessionId === sid)?.id
    : chat.activeProject ? mosaicTileId(chat.activeProject, sid) : undefined
  if (!callerTile) throw new LayoutControlError('unavailable', 'Could not find this session on screen.')
  mosaic.addTile(projectPath, child, { tileId: callerTile, edge: SESSION_EDGES[direction] }, { focus: false })
  recordDockOpener(sid, splitKey(child), openerKey(caller))
  return { status: 'applied', visible: p.windowVisible }
}
