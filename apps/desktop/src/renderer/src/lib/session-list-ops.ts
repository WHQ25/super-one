/**
 * Unified session list loading via Environment API.
 *
 * Local and remote are both ExecutionEnvironments:
 *   window.environment.listSessions(connectionId, projectId, { limit, offset })
 *
 * Product list is always paginated — limit + offset are required on every call.
 * Prefer this module over window.app.listSessions* (legacy local-only IPC).
 */
import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

export type ListSessionsPageOptions = {
  limit: number
  offset: number
  /** Optional known project id (remote only; local path is authoritative). */
  projectId?: string | null
}

type EnvironmentSessionRow = {
  sessionId: string
  title: string
  lastActiveAt: string
  provider?: string
  messageCount: number
  isPinned?: boolean
  isHidden?: boolean
  worktreePath?: string | null
  isWorktree?: boolean
  parentSessionId?: string
  gitBranch?: string
  isAutomation?: boolean
  automationId?: string | null
  acpAgentId?: string
  providerSessionId?: string
  tags?: string[]
}

/** Normalize environment listSessions rows to SessionHistoryEntry. */
export function mapEnvironmentSessionRow(row: EnvironmentSessionRow): SessionHistoryEntry {
  return {
    sessionId: row.sessionId,
    title: row.title,
    lastActiveAt: row.lastActiveAt,
    provider: (row.provider as SessionHistoryEntry['provider']) ?? 'claude',
    messageCount: row.messageCount ?? 0,
    isPinned: row.isPinned,
    isHidden: row.isHidden,
    worktreePath: row.worktreePath ?? undefined,
    isWorktree: row.isWorktree ?? Boolean(row.worktreePath),
    ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
    ...(row.gitBranch ? { gitBranch: row.gitBranch } : {}),
    ...(row.isAutomation ? { isAutomation: true } : {}),
    ...(row.automationId ? { automationId: row.automationId } : {}),
    ...(row.acpAgentId ? { acpAgentId: row.acpAgentId } : {}),
    ...(row.providerSessionId ? { providerSessionId: row.providerSessionId } : {}),
    ...(Array.isArray(row.tags) && row.tags.length
      ? { tags: row.tags.filter((t): t is string => typeof t === 'string') }
      : {}),
  }
}

/** Full-page hasMore heuristic shared by history / chat-store (page-size convention). */
export function sessionsPageHasMore(page: SessionHistoryEntry[], pageSize: number): boolean {
  return page.length >= pageSize
}

/**
 * Resolve environment connection id for a UI project key.
 * Local projects use the path (or any non-remote key) with connectionId `local`.
 */
export function connectionIdForProjectKey(projectKey: string): string {
  return parseRemoteProjectKey(projectKey)?.connectionId ?? 'local'
}

async function resolveProjectId(
  projectKey: string,
  preferredProjectId?: string | null,
): Promise<{ connectionId: string; projectId: string } | null> {
  const remote = parseRemoteProjectKey(projectKey)
  if (!remote) {
    // Local: always use the project key (folder path). Never prefer a global
    // currentProjectId — it updates async and races project switches.
    return { connectionId: 'local', projectId: projectKey }
  }
  if (preferredProjectId) {
    return { connectionId: remote.connectionId, projectId: preferredProjectId }
  }
  try {
    const projects = await window.environment.listProjects(remote.connectionId)
    const match = projects.find(
      (p) =>
        `remote:${remote.connectionId}:${p.path}` === projectKey || p.path === remote.path,
    )
    if (!match?.projectId) return null
    return { connectionId: remote.connectionId, projectId: match.projectId }
  } catch {
    return null
  }
}

/**
 * One page of sessions for a project key (local folder path or remote:… key).
 * Always goes through window.environment.listSessions with required limit/offset.
 */
export async function listSessionsPage(
  projectKey: string,
  options: ListSessionsPageOptions,
): Promise<SessionHistoryEntry[]> {
  const resolved = await resolveProjectId(projectKey, options.projectId)
  if (!resolved) return []
  const rows = await window.environment.listSessions(resolved.connectionId, resolved.projectId, {
    limit: options.limit,
    offset: options.offset,
  })
  return rows.map(mapEnvironmentSessionRow)
}

/**
 * Collect sessions by paging (for title search). Still uses limit+offset every
 * RPC — never an unpaginated dump. Stop when a short page is returned.
 */
export async function listAllSessions(
  projectKey: string,
  options?: { projectId?: string | null; pageSize?: number },
): Promise<SessionHistoryEntry[]> {
  const pageSize = options?.pageSize ?? 100
  const all: SessionHistoryEntry[] = []
  let offset = 0
  for (;;) {
    const page = await listSessionsPage(projectKey, {
      limit: pageSize,
      offset,
      projectId: options?.projectId,
    })
    all.push(...page)
    if (page.length < pageSize) break
    offset += page.length
  }
  return all
}
