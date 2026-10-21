import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import type { EnvironmentBucket, EnvironmentConnection, EnvironmentKind, HostCheckout } from './types'

/** Live chat status, already on the row. Hover does not ask the host. */
export type SessionHoverLiveStatus = 'idle' | 'running' | 'background' | 'unseen'

export interface SessionHoverModel {
  title: string
  environmentLabel: string
  kind: EnvironmentKind
  connection: EnvironmentConnection
  locationKind: 'checkout' | 'worktree'
  locationPath: string
  branch: string | null
  provider: string | null
  acpAgentId: string | null
  lastActiveAt: string
  parentTitle: string | null
  childCount: number
  startedFrom: string | null
  tags: string[]
}

export function hoverLiveStatus(status: string | null | undefined, unseen: boolean): SessionHoverLiveStatus {
  if (status === 'streaming') return 'running'
  if (status === 'background') return 'background'
  if (unseen) return 'unseen'
  return 'idle'
}

/**
 * Card contents from the session list, the checkout and the environment
 * bucket. Nothing here issues an RPC; callers pass the parent title from the
 * list they already rendered.
 */
export function buildSessionHover(input: {
  session: SessionHistoryEntry
  checkout: HostCheckout
  bucket: Pick<EnvironmentBucket, 'label' | 'kind' | 'connection'>
  parentTitle?: string | null
  childCount?: number
}): SessionHoverModel {
  const worktree = Boolean(input.session.isWorktree || input.session.worktreePath)
  return {
    title: input.session.title,
    environmentLabel: input.bucket.label,
    kind: input.bucket.kind,
    connection: input.bucket.connection,
    locationKind: worktree ? 'worktree' : 'checkout',
    locationPath: input.session.worktreePath || input.checkout.hostPath,
    branch: input.session.gitBranch ?? null,
    provider: input.session.provider ?? null,
    acpAgentId: input.session.acpAgentId ?? null,
    lastActiveAt: input.session.lastActiveAt,
    parentTitle: input.parentTitle ?? null,
    childCount: input.childCount ?? 0,
    startedFrom: input.session.remoteController?.label ?? null,
    tags: input.session.tags ?? [],
  }
}
