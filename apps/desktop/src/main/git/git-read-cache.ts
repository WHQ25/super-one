import { AsyncCoalescer } from '@superone/runtime/async-coalescer'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import type { GitMentionCapabilities } from '@superone/shared/git-mention-query'

/**
 * Worktree list and `@git` capability probes follow the project, not the
 * session. Keep them until a git mutation or the local file watcher says the
 * checkout changed. A short TTL would just re-run the same probes on every
 * session switch.
 */
const worktrees = new AsyncCoalescer<WorktreeInfo | null>(Number.POSITIVE_INFINITY)
const mentions = new AsyncCoalescer<GitMentionCapabilities>(Number.POSITIVE_INFINITY)

export function cachedLocalWorktreeInfo(
  folderPath: string,
  compute: () => Promise<WorktreeInfo | null>,
): Promise<WorktreeInfo | null> {
  return worktrees.get(folderPath, compute)
}

export function cachedLocalGitMentionCapabilities(
  folderPath: string,
  compute: () => Promise<GitMentionCapabilities>,
): Promise<GitMentionCapabilities> {
  return mentions.get(folderPath, compute)
}

export function invalidateLocalGitMentionCapabilities(folderPath: string): void {
  mentions.invalidate(folderPath)
}

/** Drop cached local worktree and mention reads for one folder, or every folder. */
export function invalidateLocalGitReads(folderPath?: string): void {
  if (folderPath) {
    worktrees.invalidate(folderPath)
    mentions.invalidate(folderPath)
    return
  }
  worktrees.clear()
  mentions.clear()
}
