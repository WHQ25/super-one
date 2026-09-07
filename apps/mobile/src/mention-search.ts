import type { RelayClient } from '@superone/relay-client'
import { randomId } from './ids'

export type MentionSearchResult = {
  items?: unknown[]
  agentTargets?: unknown
  capabilityIds?: unknown
  /** The directory the host actually searched — a worktree, not the project. */
  cwd?: string
  /**
   * Which of the requested options the host honoured. Absent on hosts that
   * predate them, which is exactly what makes it a capability probe: a scoped
   * request answered project-wide looks identical otherwise, and its top-20 may
   * have ranked every in-scope file out.
   */
  appliedOptions?: { scopeDir?: boolean; additionalDirs?: boolean }
  error?: string
}

export interface MentionSearchOptions {
  /** Confine the search to this directory, relative to the session's cwd. */
  scopeDir?: string
}

/** Works before session creation as well as inside an active chat. */
export function requestMentionSearch(
  client: Pick<RelayClient, 'request'>,
  projectPath: string,
  query: string,
  options: MentionSearchOptions = {},
): Promise<MentionSearchResult> {
  return client.request({
    type: 'search_mentions',
    requestId: randomId(),
    projectPath,
    query,
    ...(options.scopeDir !== undefined ? { scopeDir: options.scopeDir } : {}),
  }) as Promise<MentionSearchResult>
}
