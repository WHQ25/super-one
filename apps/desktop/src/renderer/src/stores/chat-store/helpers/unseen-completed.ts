import type { ChatStore } from '../types'

/**
 * Store patch that drops `sessionId` from a project's unseen completions, or
 * `{}` when there is nothing to drop. One shape for every "the user has now
 * seen it" path: opening the session here, the panel expanding, and the host's
 * `session_seen` receipt for a read that happened on another client.
 */
export function clearUnseenCompleted(
  state: Pick<ChatStore, 'projectSessions'>,
  projectPath: string,
  sessionId: string,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath]
  if (!project?.unseenCompletedSessions.has(sessionId)) return {}
  const next = new Set(project.unseenCompletedSessions)
  next.delete(sessionId)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...project, unseenCompletedSessions: next },
    },
  }
}
