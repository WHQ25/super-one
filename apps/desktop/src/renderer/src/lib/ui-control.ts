import type { SerializedDockview } from 'dockview-core'
import {
  UiControlError,
  type UiActRequest,
  type UiActResult,
  type UiControlCaller,
  type UiSnapshot,
  type UiTab,
  type UiTabKind,
} from '@superone/shared/ui-control'
import {
  closeActivityTab,
  diffPanelId,
  dockSessionId,
  focusActivityTab,
  getDockApi,
  isDockReady,
  maximizeActivityTab,
  openDiffTab,
  openNewFileTab,
  restoreActivityPanel,
  splitActivityTab,
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
import { collectLeaves } from '@/components/mosaic/mosaic-tree'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useAppStore } from '@/stores/app'
import { useBrowserStore } from '@/stores/browser'
import { useChatStore } from '@/stores/chat'
import { findSessionTarget } from '@/stores/chat-store/helpers/store-helpers'
import { selectActiveChatSessionId } from '@/stores/chat-store/selectors'
import { useSourceControlStore } from '@/stores/source-control'
import { useTerminalStore } from '@/stores/terminal'
import { selectPanelsFolded, useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { normalizeFileLinkTarget, toProjectRelativePath } from '@/lib/file-link'
import { setActivityPanelShown, toggleActivitySide, toggleSidebar } from '@/lib/layout-actions'

/**
 * The single implementation behind `ui_snapshot` / `ui_act` and a mini-app's
 * `context.layout`. Contract and rules: docs/features/ui-control.md.
 *
 * Every call is scoped to the caller's session. Its own layout (activity panel,
 * tabs, bottom terminal) is changed even when the user is looking elsewhere —
 * a parked layout takes the change when it is next shown. Window-wide state
 * (sidebar, panel side, split view) changes only while the caller is on screen.
 */

const COMPONENT_KINDS: Record<string, UiTabKind> = {
  'file-preview': 'file',
  diff: 'diff',
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

function kindOf(component: string | undefined): UiTabKind {
  return (component && COMPONENT_KINDS[component]) || 'other'
}

function openerKey(caller: UiControlCaller): DockOpener {
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

const TERMINAL_PANEL_PREFIX = 'terminal-'

/** terminal_tabs names a terminal by its bare id, so the snapshot does too. */
function publicTabId(panelId: string): string {
  return panelId.startsWith(TERMINAL_PANEL_PREFIX) ? panelId.slice(TERMINAL_PANEL_PREFIX.length) : panelId
}

function openedBy(sessionId: string, tab: string): UiTab['openedBy'] {
  const opener = dockOpener(sessionId, tab)
  if (opener === null) return 'user'
  return opener === 'agent' ? 'agent' : 'miniapp'
}

/** A snapshot row plus the dock panel id it stands for. */
type TabRow = UiTab & { panelId: string }

function liveTabs(sessionId: string): TabRow[] {
  const api = getDockApi()
  if (!api) return []
  const groupIndex = new Map(api.groups.map((group, index) => [group.id, index]))
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

type GridNode = { type: 'leaf' | 'branch'; data: unknown }
interface GroupState { id: string; views: string[]; activeView?: string }

function layoutGroups(node: GridNode | undefined, out: GroupState[] = []): GroupState[] {
  if (!node) return out
  if (node.type === 'leaf') out.push(node.data as GroupState)
  else for (const child of node.data as GridNode[]) layoutGroups(child, out)
  return out
}

/** A parked session's tabs: its saved layout, the browser tabs it will materialize, then its queued changes. */
function parkedTabs(sessionId: string): TabRow[] {
  const layout = useActivityViewStateStore.getState().perSession[sessionId]?.layout as SerializedDockview | null | undefined
  const tabs: TabRow[] = []
  if (layout) {
    for (const [index, group] of layoutGroups(layout.grid.root as GridNode).entries()) {
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
      tabs.push({ tab: publicTabId(change.tab), panelId: change.tab, kind: change.preview.kind as UiTabKind, title: change.preview.title, active: false, group: 0, openedBy: openedBy(sessionId, change.tab) })
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
function sessionRoot(caller: UiControlCaller): string | null {
  if (caller.root) return caller.root
  const chat = useChatStore.getState()
  const target = findSessionTarget(chat, caller.sessionId)
  if (!target) return null
  return chat.projectSessions[target.projectPath]?._sessions[target.sessionId]?._worktreePath ?? target.projectPath
}

export function uiSnapshot(caller: UiControlCaller): UiSnapshot {
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
    tabs,
    ...(selfTab && tabs.some((t) => t.tab === selfTab) ? { self: selfTab } : {}),
  }
}

function invalid(message: string): never {
  throw new UiControlError('invalid', message)
}

/** The dock panel id behind a tab id from the snapshot (or a terminal_tabs / browser_tabs id). */
function requireTab(sessionId: string, tab: string | undefined): string {
  if (!tab) invalid('tab is required. Use a tab id from ui_snapshot.')
  const row = sessionTabs(sessionId).find((t) => t.tab === tab || t.panelId === tab)
  if (!row) throw new UiControlError('not_found', `No tab ${tab} in this session's layout. Call ui_snapshot for current tab ids.`)
  return row.panelId
}

/** Apply a dock change now when the caller's layout is live, otherwise park it with that layout. */
function dockChange(sessionId: string, change: QueuedDockChange): UiActResult {
  if (placement(sessionId).dockLive) {
    change.run()
    return { status: 'applied', visible: panelOnScreen(sessionId), ...(change.tab ? { tab: publicTabId(change.tab) } : {}) }
  }
  queueDockChange(sessionId, change)
  return { status: 'queued', visible: false, ...(change.tab ? { tab: publicTabId(change.tab) } : {}) }
}

function skipped(): UiActResult {
  return { status: 'skipped', visible: false, reason: 'not_visible' }
}

/** Open a tab and record who opened it — unless it is already there, in which case it stays the user's. */
function openTab(caller: UiControlCaller, tab: string, preview: { kind: UiTabKind; title: string }, run: () => void): UiActResult {
  const sid = caller.sessionId
  if (!sessionTabs(sid).some((t) => t.panelId === tab)) recordDockOpener(sid, tab, openerKey(caller))
  return dockChange(sid, { kind: 'open', tab, preview, run })
}

export async function uiAct(caller: UiControlCaller, request: UiActRequest): Promise<UiActResult> {
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
    case 'open_diff': {
      const root = sessionRoot(caller)
      if (!root) throw new UiControlError('unavailable', 'This session has no project folder to diff.')
      const target = { root, ...(request.commit ? { commit: request.commit } : {}), ...(request.path ? { path: request.path } : {}) }
      const tab = diffPanelId(target)
      return openTab(caller, tab, { kind: 'diff', title: request.path?.split('/').pop() ?? request.commit ?? 'Uncommitted changes' }, () => openDiffTab(target))
    }
    case 'focus_tab': {
      const tab = requireTab(sid, request.tab)
      return dockChange(sid, { kind: 'focus', tab, run: () => { focusActivityTab(tab) } })
    }
    case 'split_tab': {
      const tab = requireTab(sid, request.tab)
      const direction = request.direction === 'down' ? 'below' : 'right'
      return dockChange(sid, { kind: 'split', tab, run: () => { splitActivityTab(tab, direction) } })
    }
    case 'close_tab': {
      const tab = requireTab(sid, request.tab)
      if (dockOpener(sid, tab) !== openerKey(caller)) {
        throw new UiControlError('not_owned', `Tab ${tab} was not opened by you; only tabs you opened can be closed.`)
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
    case 'split_session':
      return splitSession(caller, request)
    case 'close_split': {
      const child = request.sessionId
      if (!child) invalid('sessionId is required for close_split.')
      const p = placement(sid)
      if (!p.chatOnScreen) return skipped()
      const root = useMosaicStore.getState().root
      const leaf = root ? collectLeaves(root).find((candidate) => candidate.sessionId === child) : undefined
      if (!leaf) throw new UiControlError('not_found', `Session ${child} is not in the split view.`)
      if (dockOpener(sid, splitKey(child)) !== openerKey(caller)) {
        throw new UiControlError('not_owned', `The pane for ${child} was not added by you; only panes you added can be closed.`)
      }
      useMosaicStore.getState().removeTile(leaf.id)
      forgetDockOpener(sid, splitKey(child))
      return { status: 'applied', visible: p.windowVisible }
    }
    default:
      return invalid(`Unknown action: ${String((request as { action?: unknown }).action)}`)
  }
}

async function splitSession(caller: UiControlCaller, request: UiActRequest): Promise<UiActResult> {
  const sid = caller.sessionId
  const child = request.sessionId
  if (!child) invalid('sessionId is required for split_session.')
  if (child === sid) invalid('sessionId must be a session you launched, not your own.')
  if (!placement(sid).chatOnScreen) return skipped()
  const childProject = await window.app.getSpawnedSessionProject(sid, child)
  if (!childProject) throw new UiControlError('not_child', `Session ${child} was not launched by this session. Only sessions you started with session_collab_* can be split in.`)
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
  if (!callerTile) throw new UiControlError('unavailable', 'Could not find this session on screen.')
  mosaic.addTile(projectPath, child, { tileId: callerTile, edge: request.direction === 'down' ? 'bottom' : 'right' }, { focus: false })
  recordDockOpener(sid, splitKey(child), openerKey(caller))
  return { status: 'applied', visible: p.windowVisible }
}
