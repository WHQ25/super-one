import type { LayoutTabKind } from '@superone/shared/layout-control'
import {
  closeActivityTab,
  closeActivityTerminalTab,
  closeBrowserTab,
  closeDeviceTab,
  closeMcpAppTab,
  closeSideChatTab,
  closeToolUiPreviewTab,
  closeTrajectoryTab,
  getDockApi,
} from '@/components/activity/activity-panel-api'
import { bumpActivityDockRevision } from '@/components/activity/activity-dock-revision'
import { clearDockChanges, forgetDockOpener } from '@/components/activity/dock-ownership'
import { forgetSessionTerminal, sessionTerminals, terminalLayoutOwner } from '@/components/activity/session-terminals'
import { listSessionActivityTabs, sessionDockIsLive, type SessionActivityTab } from '@/lib/layout-control'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useMiniAppStore } from '@/stores/miniapp'
import { useTerminalStore } from '@/stores/terminal'
import { useToolUiPreviewStore } from '@/stores/miniapp-tool-preview'

export interface SessionTabCount {
  kind: LayoutTabKind
  count: number
}

/** Terminal and the launcher kinds first, then the rest of the dock. */
const TAB_KIND_ORDER: readonly LayoutTabKind[] = [
  'terminal',
  'browser',
  'device',
  'file',
  'miniapp',
  'trajectory',
  'side-chat',
  'tool-preview',
  'mcp-app',
  'mod-pane',
  'plugin-panel',
  'review',
  'other',
]

const TOOL_UI_PREFIX = 'tool-ui-preview:'
const MCP_APP_PREFIX = 'mcp-app:'

/** Open activity-panel tabs for one session, one entry per kind that has any. */
export function sessionTabCounts(layoutKey: string): SessionTabCount[] {
  const counts = new Map<LayoutTabKind, number>()
  for (const tab of listSessionActivityTabs(layoutKey)) {
    counts.set(tab.kind, (counts.get(tab.kind) ?? 0) + 1)
  }
  return TAB_KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind) ?? 0
    return count > 0 ? [{ kind, count }] : []
  })
}

function tabParams(layoutKey: string, panelId: string): Record<string, unknown> {
  const live = getDockApi()?.panels.find((panel) => panel.id === panelId)
  if (live?.params && typeof live.params === 'object') return live.params as Record<string, unknown>
  const saved = useActivityViewStateStore.getState().perSession[layoutKey]?.layout?.panels?.[panelId] as { params?: Record<string, unknown> } | undefined
  return saved?.params ?? {}
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value ? value : undefined
}

/** Another session still has this mini-app on screen or in its parked layout. */
function miniAppShownElsewhere(instanceKey: string, layoutKey: string): boolean {
  const panelId = `miniapp-${instanceKey}`
  const state = useActivityViewStateStore.getState()
  if (state._currentSessionId && state._currentSessionId !== layoutKey) {
    if (getDockApi()?.panels.some((panel) => panel.id === panelId)) return true
  }
  for (const [sid, view] of Object.entries(state.perSession)) {
    if (sid === layoutKey) continue
    if (view.layout?.panels && panelId in view.layout.panels) return true
  }
  return false
}

function closeBoundTab(layoutKey: string, tab: SessionActivityTab, live: boolean): void {
  const params = tabParams(layoutKey, tab.panelId)
  switch (tab.kind) {
    case 'browser':
      closeBrowserTab(tab.panelId)
      break
    case 'terminal':
      closeActivityTerminalTab(tab.tab)
      forgetSessionTerminal(tab.tab)
      break
    case 'device': {
      const instanceId = stringParam(params, 'instanceId')
        ?? (tab.panelId.startsWith('device-') ? tab.panelId.slice('device-'.length) : '')
      if (instanceId) closeDeviceTab(instanceId)
      break
    }
    case 'miniapp': {
      const instanceKey = tab.panelId.startsWith('miniapp-') ? tab.panelId.slice('miniapp-'.length) : ''
      if (instanceKey && (live || !miniAppShownElsewhere(instanceKey, layoutKey))) {
        void useMiniAppStore.getState().closeApp(instanceKey)
      }
      break
    }
    case 'tool-preview': {
      const key = tab.panelId.startsWith(TOOL_UI_PREFIX) ? tab.panelId.slice(TOOL_UI_PREFIX.length) : ''
      if (key) {
        closeToolUiPreviewTab(key)
        useToolUiPreviewStore.getState().remove(key)
      }
      break
    }
    case 'side-chat': {
      if (live) closeSideChatTab()
      const sessionId = stringParam(params, 'sessionId')
      void import('@/lib/side-chat-actions').then((m) => m.handleSideChatTabRemoved(sessionId))
      break
    }
    case 'mcp-app': {
      const key = tab.panelId.startsWith(MCP_APP_PREFIX) ? tab.panelId.slice(MCP_APP_PREFIX.length) : ''
      if (key) closeMcpAppTab(key)
      else if (live) closeActivityTab(tab.panelId)
      break
    }
    case 'mod-pane': {
      const sessionId = stringParam(params, 'sessionId')
      const paneId = stringParam(params, 'paneId')
      const projectPath = stringParam(params, 'projectPath')
      if (sessionId && paneId && projectPath) {
        void import('@/lib/mod-ui/pane-actions').then((m) => m.discardModPane({ projectPath, sessionId, paneId }))
      }
      break
    }
    case 'trajectory': {
      const sessionId = stringParam(params, 'sessionId')
      if (live && sessionId) closeTrajectoryTab(sessionId)
      break
    }
    default:
      if (live) closeActivityTab(tab.panelId)
      break
  }
  forgetDockOpener(layoutKey, tab.panelId)
}

/**
 * Close every activity-panel tab bound to this session, and kill the PTYs that
 * belong to it. The bottom terminal drawer is per session too, so it closes;
 * its PTYs are shared with the project and stay up for the other sessions.
 *
 * A parked session's dock is only JSON. Releasing those tabs must not close
 * whatever the session on screen has open.
 */
export function closeSessionBoundTabs(layoutKey: string): void {
  const live = sessionDockIsLive(layoutKey)
  for (const tab of listSessionActivityTabs(layoutKey)) {
    try {
      closeBoundTab(layoutKey, tab, live)
    } catch (err) {
      console.warn('[settle] failed to close tab', tab.panelId, err)
    }
  }
  if (live) useActivityViewStateStore.getState().park(layoutKey)
  else useActivityViewStateStore.getState().clearForSession(layoutKey)
  // A parked open queued while this session was away would otherwise come back
  // the next time it is shown. clearForSession already drops its own queue.
  clearDockChanges(layoutKey)
  useTerminalStore.getState().setOpen(layoutKey, false)
  bumpActivityDockRevision()
  void sweepOwnedTerminals(layoutKey)
}

/** Agent PTYs opened while this session was off screen are not in its saved layout yet. */
async function sweepOwnedTerminals(layoutKey: string): Promise<void> {
  const list = window.terminal?.list
  if (!list) {
    for (const ref of sessionTerminals(layoutKey)) forgetSessionTerminal(ref.terminalId)
    return
  }
  try {
    const items = await list()
    for (const item of items) {
      if (terminalLayoutOwner(item) !== layoutKey) continue
      if (item.status !== 'exited') closeActivityTerminalTab(item.terminalId)
      forgetSessionTerminal(item.terminalId)
    }
  } catch (err) {
    console.warn('[settle] failed to close session terminals', err)
  }
  for (const ref of sessionTerminals(layoutKey)) forgetSessionTerminal(ref.terminalId)
}
