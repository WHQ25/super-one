import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import {
  countMessagesForSessions,
  findSessionAcrossProjects,
  listPinnedSessions,
  listSessionsForFolder,
  searchSessionsByTitle,
} from '../db-sessions'
import { listScheduledSends } from '../db-scheduled-sends'
import type { Session } from '../session/types'

export type SessionListQuery =
  | { kind: 'page'; projectPath: string; limit?: number; offset?: number }
  | { kind: 'pinned' }
  | { kind: 'search'; query: string; limit?: number }
  | { kind: 'find'; sessionId: string }

/** Bounded native sidebar paging, validated before any storage reads. */
export function sessionListPageNumber(value: unknown, name: 'limit' | 'offset'): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (name === 'limit' ? 1 : 0) || name === 'limit' && value > 200) {
    throw Object.assign(new Error(`${name} must be ${name === 'limit' ? 'an integer from 1 to 200' : 'a non-negative integer'}`), { code: 'invalid_argument' })
  }
  return value
}

/** Shared projection for the phone's project list, pinned section, search and links. */
export function readRemoteSessionList(command: SessionListQuery, manager?: { getSession(id: string): Pick<Session, 'snapshot' | 'activityStatus'> | null | undefined } | null) {
  if ('limit' in command) sessionListPageNumber(command.limit, 'limit')
  if ('offset' in command) sessionListPageNumber(command.offset, 'offset')
  // One read for the whole page, including sessions whose runtime was released.
  // An unarmed quota offer is not a promise to send; the sidebar must stay quiet.
  const scheduled = new Map(listScheduledSends().filter(row => row.armed).map(row => [row.sessionId, row.sendAt]))
  // Rows that span projects carry their project alongside, so the phone can
  // open one it has never listed.
  const crossProject = ({ folderPath, folderName, ...session }: PinnedSessionEntry) => ({
    ...session,
    projectPath: folderPath,
    projectName: folderName,
    scheduledSendAt: scheduled.get(session.sessionId) ?? null,
  })
  if (command.kind === 'find') {
    const row = findSessionAcrossProjects(command.sessionId)
    return { session: row ? crossProject(row) : null }
  }
  if (command.kind !== 'page') {
    const rows = command.kind === 'search'
      ? searchSessionsByTitle(command.query, command.limit)
      : listPinnedSessions()
    return { sessions: rows.map(crossProject) }
  }

  const listed = listSessionsForFolder(command.projectPath).filter(session => !session.isHidden)
  // Armed sends lead the first page: the phone lists them above older rows, as
  // desktop does, and a row it never pages in cannot be promoted there.
  const visibleSessions = [
    ...listed.filter(session => scheduled.has(session.sessionId)),
    ...listed.filter(session => !scheduled.has(session.sessionId)),
  ]
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
        status: live?.activityStatus() ?? 'idle',
        tags: session.tags ?? [],
        gitBranch: session.gitBranch ?? null,
        isWorktree: session.isWorktree ?? false,
        worktreePath: session.worktreePath ?? null,
        isPinned: session.isPinned ?? false,
        parentSessionId: session.parentSessionId ?? null,
        ...(session.isAutomation ? { isAutomation: true } : {}),
        scheduledSendAt: scheduled.get(session.sessionId) ?? null,
      }
    }),
  }
}
