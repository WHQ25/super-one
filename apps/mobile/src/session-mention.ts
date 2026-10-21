import {
  buildSessionProjectOptions,
  listSessionProjectCompletions,
  parseSessionMentionQuery,
  titleMatchIndices,
  type ParsedSessionMentionQuery,
  type ProjectOption,
} from '@superone/shared/session-mention-query'
import type { SessionListRow } from './session-list-state'
import type { MentionItem } from './mentions'

export { isSessionMentionQuery, SESSION_MENTION_NAV_PREFIX, SESSION_MENTION_SEARCH_LIMIT } from '@superone/shared/session-mention-query'

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
): ParsedSessionMentionQuery | null {
  return parseSessionMentionQuery(query, { projects })
}

/**
 * Project labels the user can complete while the first token is still open.
 * `navigateTo` is `session <label> `, which scopes every project with that label.
 */
export function sessionProjectItems(
  projects: ProjectOption[],
  projectToken: string,
  currentProjectKey: string | null,
): MentionItem[] {
  return listSessionProjectCompletions(projects, projectToken, currentProjectKey).map((choice) => ({
    kind: 'session-project',
    path: choice.label,
    label: choice.label,
    description: choice.hint,
    labelIndices: choice.matchIndices,
    navigateTo: `session ${choice.token} `,
  }))
}

export function sessionItems(rows: readonly SessionListRow[], titleQuery: string, showProject = true): MentionItem[] {
  return rows.map((row) => ({
    kind: 'session',
    path: row.sessionId,
    label: row.title || row.sessionId,
    ...(showProject && row.projectName ? { description: row.projectName } : {}),
    ...(row.provider ? { badge: row.provider } : {}),
    labelIndices: titleMatchIndices(row.title || '', titleQuery),
  }))
}

/** What "nothing here" means — recent archive, or a title that matched nothing. */
export function sessionEmptyLabel(phase: ParsedSessionMentionQuery['phase']): string {
  return phase === 'recent' ? 'No recent sessions' : 'No matching sessions'
}
