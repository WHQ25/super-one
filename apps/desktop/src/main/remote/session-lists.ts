import type { RemoteCommand } from '@superone/shared/agent-types'
import { countMessagesForSessions, listPinnedSessions, listSessionsForFolder, searchSessionsByTitle } from '../db-sessions'
import { listScheduledSends } from '../db-scheduled-sends'
import type { SessionManager } from '../session/types'

type SessionListCommand = Extract<RemoteCommand, { type: 'list_sessions' | 'list_pinned_sessions' | 'search_sessions' }>

/** Shared projection for the phone's project list, pinned section and search. */
export function readRemoteSessionList(command: SessionListCommand, manager?: SessionManager | null) {
  // One read for the whole page, including sessions whose runtime was released.
  // An unarmed quota offer is not a promise to send; the sidebar must stay quiet.
  const scheduled = new Map(listScheduledSends().filter(row => row.armed).map(row => [row.sessionId, row.sendAt]))
  if (command.type !== 'list_sessions') {
    const rows = command.type === 'search_sessions'
      ? searchSessionsByTitle(command.query, command.limit)
      : listPinnedSessions()
    return {
      sessions: rows.map(({ folderPath, folderName, ...session }) => ({
        ...session,
        projectPath: folderPath,
        projectName: folderName,
        scheduledSendAt: scheduled.get(session.sessionId) ?? null,
      })),
    }
  }

  const visibleSessions = listSessionsForFolder(command.projectPath).filter(session => !session.isHidden)
  const offset = command.offset ?? 0
  const visible = visibleSessions.slice(offset, offset + (command.limit ?? 10))
  const messageCounts = countMessagesForSessions(visible.map(session => session.sessionId))
  return {
    totalCount: visibleSessions.length,
    sessions: visible.map(session => {
      const live = manager?.getSession(session.sessionId)
      return {
        sessionId: session.sessionId,
        title: session.title,
        lastActiveAt: session.lastActiveAt,
        messageCount: messageCounts.get(session.sessionId) ?? 0,
        provider: session.provider ?? 'claude',
        acpAgentId: session.acpAgentId ?? null,
        selectedModel: live?.snapshot.selectedModel || session.selectedModel || null,
        status: live?.snapshot.status ?? 'idle',
        tags: session.tags ?? [],
        gitBranch: session.gitBranch ?? null,
        isWorktree: session.isWorktree ?? false,
        worktreePath: session.worktreePath ?? null,
        isPinned: session.isPinned ?? false,
        parentSessionId: session.parentSessionId ?? null,
        scheduledSendAt: scheduled.get(session.sessionId) ?? null,
      }
    }),
  }
}
