import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { pathBasename } from '@superone/shared/collab-request-display'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'
import type { EnvironmentBucket, EnvironmentConnection, EnvironmentKind, HostCheckout } from './types'

export interface SessionHoverModel {
  title: string
  environmentLabel: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  path?: NodeLinkPath
  /** Null when the session runs in the project checkout. */
  worktreeName: string | null
  lastActiveAt: string
  tags: string[]
}

/**
 * Card contents from the session list, the checkout and the environment
 * bucket. Nothing here issues an RPC.
 */
export function buildSessionHover(input: {
  session: SessionHistoryEntry
  checkout: HostCheckout
  bucket: Pick<EnvironmentBucket, 'label' | 'kind' | 'connection' | 'path'>
}): SessionHoverModel {
  const { session } = input
  const worktreeName = session.worktreePath
    ? pathBasename(session.worktreePath)
    : session.isWorktree ? (session.gitBranch ?? null) : null
  return {
    title: session.title,
    environmentLabel: input.bucket.label,
    kind: input.bucket.kind,
    connection: input.bucket.connection,
    ...(input.bucket.path ? { path: input.bucket.path } : {}),
    worktreeName,
    lastActiveAt: session.lastActiveAt,
    tags: session.tags ?? [],
  }
}
