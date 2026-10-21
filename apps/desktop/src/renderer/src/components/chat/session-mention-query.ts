/**
 * The `@session` grammar lives in `@superone/shared/session-mention-query`.
 * What stays here is the desktop's host search: rows come through
 * `window.environment`, which a shared module must not know about.
 */
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type { ProjectOption } from '@superone/shared/session-mention-query'
import { buildSessionProjectOptions } from '@superone/shared/session-mention-query'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'

export {
  SESSION_MENTION_NAV_PREFIX,
  SESSION_MENTION_KEYWORD,
  SESSION_MENTION_SEARCH_LIMIT,
  SESSION_MENTION_ARGUMENT_HINT,
  isSessionMentionQuery,
  mentionQueryAllowsSpaces,
  remainingSessionArgumentHint,
  buildSessionProjectOptions,
  parseSessionMentionQuery,
  listSessionProjectCompletions,
  titleMatches,
  titleMatchIndices,
  type SessionMentionPhase,
  type ParsedSessionMentionQuery,
  type ProjectOption,
} from '@superone/shared/session-mention-query'

/** Project labels on the same host as the active project. A remote key never scopes a local folder. */
export function sessionProjectsOnHost(
  recentFolders: Array<{ path: string; name?: string; missing?: boolean }>,
  activeProject: string | null | undefined,
): ProjectOption[] {
  const connectionId = connectionIdForProjectKey(activeProject || '')
  return buildSessionProjectOptions(recentFolders, activeProject)
    .filter((project) => connectionIdForProjectKey(project.projectKey) === connectionId)
}

/** Host-local folder paths. Remote keys drop `remote:<connectionId>:`. */
export function hostLocalProjectPaths(projects: readonly ProjectOption[]): string[] {
  return projects.map((project) => parseRemoteProjectKey(project.projectKey)?.path ?? project.projectKey)
}

/**
 * Title search on the host that owns `projectKey`. An empty key is this machine.
 * `projectPaths` are already host-local. The host's order is kept.
 */
export async function searchSessionMentions(
  projectKey: string,
  query: string,
  limit?: number,
  projectPaths?: string[],
): Promise<PinnedSessionEntry[]> {
  const connectionId = connectionIdForProjectKey(projectKey || '')
  const rows = await window.environment.searchSessionsByTitle(connectionId, query, limit, projectPaths)
  return Array.isArray(rows) ? rows : []
}
