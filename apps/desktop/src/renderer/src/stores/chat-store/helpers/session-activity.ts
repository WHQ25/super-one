import type { AgentEvent, AgentStatus } from '@superone/shared/agent-types'
import type { SessionActivity } from '@superone/shared/session-activity'
import type { ChatStore, PerSessionState } from '../types'
import { createDefaultPerSessionState, createDefaultProjectState } from '../defaults'
import { applyCachedCodexPermissionPreset } from './prefs-cache'

/** Brand for a row whose transcript is not loaded yet. An empty agent does not clear one already held. */
function brandFromActivity(activity: SessionActivity): Partial<PerSessionState> {
  return {
    ...(activity.provider ? { sessionProvider: activity.provider, preferredProvider: activity.provider } : {}),
    ...(typeof activity.acpAgentId === 'string' && activity.acpAgentId ? { acpAgentId: activity.acpAgentId } : {}),
  }
}

/**
 * A paired machine's sidebar summary of one of its sessions (`session_activity`
 * on its `sessionList` topic, keyed by the desktop project key): the row's
 * running state and unread dot, as its phones show them. A session whose
 * history this window holds follows its own events, which stay authoritative
 * for its status; the summary only creates a bare entry, never a transcript.
 * That entry keeps the host harness, title and spawn parent so an unlisted live
 * child can appear under its parent before any child page or transcript loads.
 */
export function applySessionActivity(
  state: Pick<ChatStore, 'projectSessions' | 'activeProject'>,
  { activity, completed }: Extract<AgentEvent, { type: 'session_activity' }>,
): Partial<ChatStore> {
  const { projectPath, sessionId } = activity
  const project = state.projectSessions[projectPath] ?? createDefaultProjectState()
  const session = project._sessions[sessionId]
  const status = activity.status as AgentStatus
  const hydrated = session?._historyHydrated === true
  // An idle summary still names a session when it is blocked on the user.
  // Status alone would drop that row until some later running event.
  const followsStatus = session
    ? !hydrated && session.status !== status
    : status !== 'idle' || activity.pendingCount > 0
  const pendingChanged = !hydrated && (session?.activityPendingCount ?? 0) !== activity.pendingCount
    && (session != null || followsStatus)
  const metadata: Partial<PerSessionState> = !hydrated && (session || followsStatus)
    ? {
      ...brandFromActivity(activity),
      ...(activity.title ? { _title: activity.title } : {}),
      ...(activity.parentSessionId !== undefined ? { _parentSessionId: activity.parentSessionId } : {}),
    }
    : {}
  // The first activity may arrive before the title/relationship is known. A
  // later summary must fill those in even if the session is still streaming.
  const metadataChanged = Object.entries(metadata).some(([key, value]) => session?.[key as keyof PerSessionState] !== value)
  const viewing = state.activeProject === projectPath && project._activeSessionId === sessionId
  const unread = !!completed && !!activity.completedMessageId && activity.completedMessageId !== activity.seenCompletedMessageId && !viewing
  const read = !!activity.seenCompletedMessageId && activity.seenCompletedMessageId === activity.completedMessageId
  const unseen = unread && !project.unseenCompletedSessions.has(sessionId) ? new Set([...project.unseenCompletedSessions, sessionId])
    : read && project.unseenCompletedSessions.has(sessionId) ? new Set([...project.unseenCompletedSessions].filter((id) => id !== sessionId))
      : null
  const writeSession = followsStatus || metadataChanged || pendingChanged
  if (!writeSession && !unseen) return {}
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: {
        ...project,
        ...(writeSession ? { _sessions: { ...project._sessions, [sessionId]: {
          ...(session ?? { ...applyCachedCodexPermissionPreset(createDefaultPerSessionState()), _historyHydrated: false }),
          ...metadata,
          ...(followsStatus ? { status } : {}),
          ...(!hydrated ? { activityPendingCount: activity.pendingCount } : {}),
        } } } : {}),
        ...(unseen ? { unseenCompletedSessions: unseen } : {}),
      },
    },
  }
}
