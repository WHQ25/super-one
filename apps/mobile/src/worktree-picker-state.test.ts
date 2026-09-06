import { describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import {
  attachUnavailableReason,
  filterWorktreeEntries,
  worktreeBranchHeading,
} from './worktree-picker-state'

const INFO: WorktreeInfo = {
  isWorktree: false,
  currentBranch: 'main',
  entries: [
    { path: '/repo', branch: 'main', head: 'aa11bb22', isMain: true, isCurrent: true },
    { path: '/repo/.worktrees/review', branch: 'review/pr-482', head: '4c8e0b19', isMain: false, isCurrent: false },
    { path: '/repo/.worktrees/loose', branch: '', head: '9f3c1d7e', isMain: false, isCurrent: false },
  ],
}

describe('filterWorktreeEntries', () => {
  it('drops the main checkout and keeps the rest', () => {
    expect(filterWorktreeEntries(INFO, '  ').map((entry) => entry.path))
      .toEqual(['/repo/.worktrees/review', '/repo/.worktrees/loose'])
  })

  it('matches on branch, HEAD or path', () => {
    expect(filterWorktreeEntries(INFO, 'PR-482')).toHaveLength(1)
    expect(filterWorktreeEntries(INFO, '9f3c')).toHaveLength(1)
    expect(filterWorktreeEntries(INFO, 'loose')).toHaveLength(1)
    expect(filterWorktreeEntries(INFO, 'nothing')).toHaveLength(0)
  })

  it('survives a missing worktree listing', () => {
    expect(filterWorktreeEntries(null, '')).toEqual([])
  })
})

describe('attachUnavailableReason', () => {
  it('allows a branch nothing has checked out', () => {
    expect(attachUnavailableReason('feat/x', INFO, ['main'])).toBeNull()
  })

  it('names the main repo when it holds the branch', () => {
    expect(attachUnavailableReason('main', INFO, ['main'])).toBe('Already checked out in main repo')
  })

  it('names another worktree otherwise', () => {
    expect(attachUnavailableReason('review/pr-482', INFO, ['review/pr-482']))
      .toBe('Already checked out in another worktree')
  })

  it('stays silent until the worktree listing arrives', () => {
    expect(attachUnavailableReason('main', null, ['main'])).toBeNull()
  })
})

describe('worktreeBranchHeading', () => {
  it('names what picking a branch will do', () => {
    expect(worktreeBranchHeading(null)).toBe('Create new worktree from')
    expect(worktreeBranchHeading('branch')).toBe('Create new worktree from')
    expect(worktreeBranchHeading('attach')).toBe('Attach to')
    expect(worktreeBranchHeading('detach')).toBe('Detach at')
  })
})
