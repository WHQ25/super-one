import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  cachedLocalGitMentionCapabilities,
  cachedLocalWorktreeInfo,
  invalidateLocalGitReads,
  mainCheckoutOfLinkedWorktree,
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

  it('re-reads the worktree list after 30s and does not store an unsupported probe', async () => {
    vi.useFakeTimers()
    try {
      const worktree = vi.fn(async () => info)
      const mention = vi.fn(async () => ({ repo: 'unsupported', github: false }) as GitMentionCapabilities)
      await cachedLocalWorktreeInfo('/ttl', worktree)
      await cachedLocalWorktreeInfo('/ttl', worktree)
      expect(worktree).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(30_000)
      await cachedLocalWorktreeInfo('/ttl', worktree)
      expect(worktree).toHaveBeenCalledTimes(2)

      await cachedLocalGitMentionCapabilities('/ttl', mention)
      await cachedLocalGitMentionCapabilities('/ttl', mention)
      expect(mention).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      invalidateLocalGitReads()
    }
  })

  it('finds the main checkout of a linked worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'git-read-'))
    try {
      const main = join(root, 'main')
      const linked = join(root, 'linked')
      mkdirSync(join(main, '.git', 'worktrees', 'linked'), { recursive: true })
      mkdirSync(linked)
      writeFileSync(join(linked, '.git'), `gitdir: ${join('..', 'main', '.git', 'worktrees', 'linked')}\n`)
      expect(mainCheckoutOfLinkedWorktree(linked)).toBe(main)
      expect(mainCheckoutOfLinkedWorktree(main)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
