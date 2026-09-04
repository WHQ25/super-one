import { describe, expect, it } from 'vitest'
import {
  buildWorktreeCreateOptions,
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from './worktree-state'

describe('new-session worktree state', () => {
  it('keeps local sessions on the current branch', () => {
    expect(buildWorktreeCreateOptions(LOCAL_WORKTREE_SELECTION, 'main')).toEqual({ gitBranch: 'main' })
  })

  it('attaches an existing worktree path without creating another one', () => {
    expect(buildWorktreeCreateOptions({ kind: 'existing', path: '/repo/.worktrees/a', branch: 'feat/a' })).toEqual({
      worktreePath: '/repo/.worktrees/a',
      gitBranch: 'feat/a',
    })
  })

  it('maps all new worktree modes onto create_session fields', () => {
    const selection: NewSessionWorktreeSelection = {
      kind: 'create',
      baseBranch: 'main',
      mode: 'branch',
      branchName: ' feat/mobile ',
      carryLocalChanges: true,
    }
    expect(buildWorktreeCreateOptions(selection)).toEqual({
      worktreeBranch: 'main',
      worktreeMode: 'branch',
      worktreeBranchName: 'feat/mobile',
      worktreeCarryLocalChanges: true,
    })
    expect(buildWorktreeCreateOptions({ ...selection, mode: 'detach' })).toEqual({
      worktreeBranch: 'main',
      worktreeMode: 'detach',
      worktreeCarryLocalChanges: true,
    })
  })

  it('rejects collisions and checked-out attach targets', () => {
    expect(worktreeSelectionError({
      kind: 'create', baseBranch: 'main', mode: 'branch', branchName: 'main', carryLocalChanges: false,
    }, ['main'], [])).toContain('already exists')
    expect(worktreeSelectionError({
      kind: 'create', baseBranch: 'feat/a', mode: 'attach', branchName: '', carryLocalChanges: false,
    }, ['main', 'feat/a'], ['feat/a'])).toContain('already checked out')
  })
})
