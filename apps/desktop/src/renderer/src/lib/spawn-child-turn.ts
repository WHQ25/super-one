import type { AgentStatus } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { useRealtimeCallStore } from '@/stores/realtime-call'

/** What the sidebar already knows about one session. A missing child is not running. */
export interface SpawnChildTurn {
  _parentSessionId?: string | null
  status?: AgentStatus
  pendingPermissions?: readonly unknown[]
  pendingQuestion?: unknown
  pendingPlanApproval?: unknown
}

/**
 * True when a direct spawn child of `parentId` still has an open turn, as far
 * as this window can see. The host refuses the settle either way; this only
 * decides whether the icon is offered. A child that was never summarized here
 * stays invisible, and the click still fails.
 */
export function spawnChildTurnOpen(
  sessions: Readonly<Record<string, SpawnChildTurn>> | undefined,
  parentId: string,
  realtimeChildId?: string | null,
): boolean {
  if (!sessions || !parentId) return false
  for (const [id, session] of Object.entries(sessions)) {
    if (id === parentId || session._parentSessionId !== parentId) continue
    if (session.status === 'streaming' || session.status === 'background') return true
    if ((session.pendingPermissions?.length ?? 0) > 0) return true
    if (session.pendingQuestion || session.pendingPlanApproval) return true
    if (realtimeChildId != null && id === realtimeChildId) return true
  }
  return false
}

/** Spawn-child turn that should hide this parent's settle icon. */
export function useSpawnChildTurnOpen(folderPath: string, sessionId: string): boolean {
  const realtimeChildId = useRealtimeCallStore((state) => (
    state.projectPath === folderPath && state.sessionId && state.state !== 'idle' ? state.sessionId : null
  ))
  return useChatStore((state) => spawnChildTurnOpen(
    state.projectSessions[folderPath]?._sessions,
    sessionId,
    realtimeChildId,
  ))
}
