import type { RelayClient } from '@superone/relay-client'
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import {
  buildSessionProjectOptions,
  listSessionProjectChoices,
  parseSessionMentionQuery,
  titleMatchIndices,
  type ParsedSessionMentionQuery,
  type ProjectOption,
  type SessionMentionPageLoader,
  type SessionMentionRow,
} from '@superone/shared/session-mention-query'
import { readProjectSessions } from './navigation/workspace-data'
import type { MentionItem } from './mentions'

export { isSessionMentionQuery, initialSessionMentionLoadState, loadSessionMentionPage,
  SESSION_MENTION_NAV_PREFIX, type SessionMentionLoadState } from '@superone/shared/session-mention-query'

/** Projects as the phone knows them, in the shape the shared grammar expects. */
export function sessionProjectOptions(
  projects: readonly { path: string; name?: string }[],
  activeProject: string | null | undefined,
): ProjectOption[] {
  return buildSessionProjectOptions(projects.map((project) => ({ path: project.path, name: project.name })), activeProject)
}

export function parseSessionQuery(
  query: string,
  projects: ProjectOption[],
  currentProjectKey: string | null,
): ParsedSessionMentionQuery | null {
  return parseSessionMentionQuery(query, { currentProjectKey, projects })
}

/**
 * Scope choices for the first phase.
 *
 * `path` is the **label**, not the token, because that is what the row shows
 * and what the match indices were scored over. Where the query has to go is
 * carried separately, in `navigateTo` — two projects whose leaf names collide
 * are ambiguous to the grammar itself, which the shared parser documents.
 */
export function sessionProjectItems(
  projects: ProjectOption[],
  projectToken: string,
  currentProjectKey: string | null,
): MentionItem[] {
  return listSessionProjectChoices(projects, projectToken, currentProjectKey).map((choice) => ({
    kind: 'session-project',
    path: choice.label,
    label: choice.label,
    description: choice.hint,
    labelIndices: choice.matchIndices,
    navigateTo: `session ${choice.token} `,
  }))
}

export function sessionItems(rows: SessionMentionRow[], titleQuery: string): MentionItem[] {
  return rows.map((row) => ({
    kind: 'session',
    path: row.session.sessionId,
    label: row.session.title || row.session.sessionId,
    // Both sit on the title's line, as on the desktop: which project it was in,
    // then which harness ran it.
    description: row.projectLabel,
    ...(row.session.provider ? { badge: row.session.provider } : {}),
    labelIndices: titleMatchIndices(row.session.title || '', titleQuery),
  }))
}

/**
 * Page one project's sessions over the remote protocol.
 *
 * `hasMore` comes from the host's `totalCount` rather than from a full page,
 * so the last page does not have to be short to end the scan.
 */
export function sessionPageLoader(client: RelayClient, projectPath: string): SessionMentionPageLoader {
  return async (projectKey, limit, offset) => {
    const page = await readProjectSessions(client, projectKey || projectPath, { limit, offset })
    return {
      sessions: page.sessions.map((row): SessionHistoryEntry => ({
        ...row,
        lastActiveAt: row.lastActiveAt ?? '',
        messageCount: row.messageCount ?? 0,
        parentSessionId: row.parentSessionId ?? undefined,
      })),
      hasMore: offset + page.sessions.length < page.totalCount,
    }
  }
}

/** What "nothing here" means depends on which phase asked — the desktop's wording. */
export function sessionEmptyLabel(phase: ParsedSessionMentionQuery['phase']): string {
  if (phase === 'pick-project') return 'No matching projects'
  if (phase === 'need-title') return 'No recent sessions'
  return 'No matching sessions'
}
