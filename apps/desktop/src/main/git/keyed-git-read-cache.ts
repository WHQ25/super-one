import { AsyncCoalescer } from '@superone/runtime/async-coalescer'

/**
 * Two coalesced reads (worktree list and `@git` capabilities) that share one
 * invalidation key. Unstable answers are returned and not stored.
 */
export function createKeyedGitReadCache<W, M>(options: {
  worktreeTtlMs: number
  mentionTtlMs: number
  unstableWorktree?: (value: W) => boolean
  unstableMention?: (value: M) => boolean
}): {
  worktree(key: string, compute: () => Promise<W>): Promise<W>
  mention(key: string, compute: () => Promise<M>): Promise<M>
  invalidate(key?: string): void
  invalidateMatching(match: (key: string) => boolean): void
} {
  const worktrees = new AsyncCoalescer<W>(options.worktreeTtlMs)
  const mentions = new AsyncCoalescer<M>(options.mentionTtlMs)
  const worktreeOptions = options.unstableWorktree
    ? { cacheIf: (value: W) => !options.unstableWorktree!(value) }
    : undefined
  const mentionOptions = options.unstableMention
    ? { cacheIf: (value: M) => !options.unstableMention!(value) }
    : undefined
  return {
    worktree: (key, compute) => worktrees.get(key, compute, worktreeOptions),
    mention: (key, compute) => mentions.get(key, compute, mentionOptions),
    invalidate(key) {
      if (key) {
        worktrees.invalidate(key)
        mentions.invalidate(key)
        return
      }
      worktrees.clear()
      mentions.clear()
    },
    invalidateMatching(match) {
      worktrees.invalidateMatching(match)
      mentions.invalidateMatching(match)
    },
  }
}
