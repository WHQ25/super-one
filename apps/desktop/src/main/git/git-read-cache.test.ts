import { describe, expect, it, vi } from 'vitest'
import {
  cachedLocalGitMentionCapabilities,
  cachedLocalWorktreeInfo,
  invalidateLocalGitReads,
} from './git-read-cache'
import type { GitMentionCapabilities } from '@superone/shared/git-mention-query'
import type { WorktreeInfo } from '@superone/shared/agent-types'

const info = { isWorktree: false, currentBranch: 'main', entries: [] } as WorktreeInfo
const caps = { repo: 'ready', github: false } as GitMentionCapabilities

describe('local git read cache', () => {
  it('shares one probe per folder until invalidated', async () => {
    const worktree = vi.fn(async () => info)
    const mention = vi.fn(async () => caps)
    await Promise.all([
      cachedLocalWorktreeInfo('/repo', worktree),
      cachedLocalWorktreeInfo('/repo', worktree),
    ])
    await cachedLocalWorktreeInfo('/repo', worktree)
    await cachedLocalGitMentionCapabilities('/repo', mention)
    await cachedLocalGitMentionCapabilities('/repo', mention)
    expect(worktree).toHaveBeenCalledTimes(1)
    expect(mention).toHaveBeenCalledTimes(1)

    invalidateLocalGitReads('/repo')
    await cachedLocalWorktreeInfo('/repo', worktree)
    await cachedLocalGitMentionCapabilities('/repo', mention)
    expect(worktree).toHaveBeenCalledTimes(2)
    expect(mention).toHaveBeenCalledTimes(2)
    invalidateLocalGitReads()
  })
})
