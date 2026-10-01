import { McpAppsError } from '@superone/shared/mcp-apps'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { useChatStore } from '@/stores/chat'
import type { McpAppRoute } from './desktop-executor'

/** Adopt the host-created empty session before DB-only navigation can apply defaults. */
export async function navigateMcpAppSession(route: McpAppRoute): Promise<void> {
  if (parseRemoteProjectKey(route.projectPath)) {
    const { hydrateRemoteSessionWithCatalog } = await import('@/lib/remote-session-ops')
    const state = useChatStore.getState()
    const previous = state.projectSessions[route.projectPath]?._sessions[route.sessionId]
    const { hydrated, snap } = await hydrateRemoteSessionWithCatalog(route.projectPath, route.sessionId, previous, { adoptSession: true })
    if (!snap?.sessionId || !snap.harnessId) throw new McpAppsError('not_connected', 'The host-created node conversation is unavailable')
    useChatStore.setState(state => {
      const project = state.projectSessions[route.projectPath]
      if (!project) throw new McpAppsError('not_connected', 'The node project is unavailable')
      return { projectSessions: { ...state.projectSessions, [route.projectPath]: {
        ...project, _sessions: { ...project._sessions, [route.sessionId]: hydrated },
      } } }
    })
    await useChatStore.getState().switchToSession(route.projectPath, route.sessionId)
    return
  }
  await useChatStore.getState().syncLiveSnapshots({ adoptSession: route })
  const state = useChatStore.getState()
  if (!state.projectSessions[route.projectPath]?._sessions[route.sessionId]?.sessionProvider) {
    throw new McpAppsError('not_connected', 'The host-created conversation is unavailable')
  }
  if (state.activeProject !== route.projectPath) await state.switchToSession(route.projectPath, route.sessionId)
  // Live hydration can mark this session active already. Still run the normal
  // switch so its cwd/worktree and runtime settings reach the surrounding UI.
  await useChatStore.getState().switchSession(route.sessionId)
}
