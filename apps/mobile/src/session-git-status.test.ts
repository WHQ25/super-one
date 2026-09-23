import { describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import { describeSessionGit, sessionGitLabel, type SessionGitFacts } from './session-git-status'

const WORKTREES: WorktreeInfo = {
  isWorktree: false,
  currentBranch: 'main',
  entries: [
    { path: '/repo', branch: 'main', head: 'aaaaaaabbbbbbb', isMain: true, isCurrent: true },
    { path: '/repo/.worktrees/review', branch: 'review/pr-1', head: '4c8e0b19a7f3', isMain: false, isCurrent: false },
    { path: '/repo/.worktrees/detached', branch: '', head: '9f3c1d7e5a20', isMain: false, isCurrent: false },
  ],
}

function facts(overrides: Partial<SessionGitFacts> = {}): SessionGitFacts {
  return {
    isWorktree: false,
    worktreePath: null,
    worktreeRemoved: false,
    sessionBranch: null,
    projectBranch: 'main',
    projectHead: null,
    projectDirtyFiles: 0,
    worktree: WORKTREES,
    ...overrides,
  }
}

describe('session git status', () => {
  it('names the live project branch for a local session, not the one it started on', () => {
    // The user switched branches under a running session; the snapshot still
    // says `main`, and showing that would describe a checkout nobody is on.
    expect(describeSessionGit(facts({ sessionBranch: 'main', projectBranch: 'feat/x' })))
      .toEqual({ kind: 'branch', branch: 'feat/x', dirtyFiles: 0 })
  })

  it('carries the uncommitted file count on a local branch', () => {
    expect(describeSessionGit(facts({ projectDirtyFiles: 4 })))
      .toEqual({ kind: 'branch', branch: 'main', dirtyFiles: 4 })
  })

  it('shows the commit when the project checkout is detached', () => {
    expect(describeSessionGit(facts({ projectBranch: null, projectHead: 'a1b2c3d' })))
      .toEqual({ kind: 'detached', head: 'a1b2c3d' })
  })

  it('renders nothing when the host reports neither a branch nor a head', () => {
    expect(describeSessionGit(facts({ projectBranch: null, projectHead: null }))).toBeNull()
  })

  it('keeps the worktree branch even after the project moves to another branch', () => {
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/review',
      sessionBranch: 'review/pr-1',
      projectBranch: 'feat/x',
    }))).toEqual({ kind: 'worktreeBranch', branch: 'review/pr-1' })
  })

  it('follows a branch created in the worktree after the session started detached', () => {
    // The snapshot records no branch for a detached start; the worktree list is
    // the only place the later `git switch -c` shows up.
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/review',
      sessionBranch: null,
    }))).toEqual({ kind: 'worktreeBranch', branch: 'review/pr-1' })
  })

  it('falls back to the snapshot branch until the worktree list loads', () => {
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/review',
      sessionBranch: 'review/pr-1',
      worktree: null,
    }))).toEqual({ kind: 'worktreeBranch', branch: 'review/pr-1' })
  })

  it('resolves a detached worktree to its own short head, not the project one', () => {
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/detached',
      sessionBranch: '',
      projectHead: 'deadbee',
    }))).toEqual({ kind: 'worktreeDetached', head: '9f3c1d7' })
  })

  it('stays silent for a detached worktree the worktree list has not loaded yet', () => {
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/detached',
      sessionBranch: null,
      worktree: null,
    }))).toBeNull()
  })

  it('never reports the project dirty count beside a worktree', () => {
    const view = describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/review',
      sessionBranch: 'review/pr-1',
      projectDirtyFiles: 12,
    }))
    expect(view).not.toHaveProperty('dirtyFiles')
  })

  it('reports a removed worktree ahead of any branch it used to be on', () => {
    expect(describeSessionGit(facts({
      isWorktree: true,
      worktreePath: '/repo/.worktrees/review',
      sessionBranch: 'review/pr-1',
      worktreeRemoved: true,
    }))).toEqual({ kind: 'worktreeMissing' })
  })

  it('ignores a stale removal flag once the session is back on the project', () => {
    expect(describeSessionGit(facts({ worktreeRemoved: true })))
      .toEqual({ kind: 'branch', branch: 'main', dirtyFiles: 0 })
  })
})

describe('session git labels', () => {
  it('counts uncommitted files in the singular', () => {
    expect(sessionGitLabel({ kind: 'branch', branch: 'main', dirtyFiles: 1 }))
      .toBe('Branch main, 1 uncommitted file')
  })

  it('omits the count on a clean tree', () => {
    expect(sessionGitLabel({ kind: 'branch', branch: 'main', dirtyFiles: 0 })).toBe('Branch main')
  })

  it('says where a worktree session actually runs', () => {
    expect(sessionGitLabel({ kind: 'worktreeDetached', head: '9f3c1d7' }))
      .toBe('Worktree detached at 9f3c1d7')
  })
})
