import { describe, expect, it } from 'vitest'
import {
  buildWorktreeCreateOptions,
  LOCAL_WORKTREE_SELECTION,
  workDirChipState,
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

describe('workDirChipState', () => {
  const worktree = {
    isWorktree: false, currentBranch: 'main',
    entries: [{ path: '/w', head: '1a2b3c4d5e6f', isMain: false, branch: null }],
  } as never

  it('reads as local for the default selection', () => {
    expect(workDirChipState(LOCAL_WORKTREE_SELECTION)).toEqual({ kind: 'local' })
  })

  it('names the branch of an existing worktree', () => {
    expect(workDirChipState({ kind: 'existing', path: '/w', branch: 'feat/x' }))
      .toEqual({ kind: 'activeBranch', name: 'feat/x' })
  })

  it('falls back to the short HEAD when the worktree is detached', () => {
    expect(workDirChipState({ kind: 'existing', path: '/w' }, worktree))
      .toEqual({ kind: 'activeDetached', hash: '1a2b3c4' })
  })

  it('leaves the hash empty when the worktree is unknown', () => {
    expect(workDirChipState({ kind: 'existing', path: '/gone' }, worktree))
      .toEqual({ kind: 'activeDetached', hash: '' })
  })

  it('maps each create mode onto the desktop state', () => {
    expect(workDirChipState({ kind: 'create', baseBranch: 'main', mode: 'branch', branchName: ' feat/y ', carryLocalChanges: false }))
      .toEqual({ kind: 'createBranch', name: 'feat/y' })
    expect(workDirChipState({ kind: 'create', baseBranch: 'main', mode: 'attach', branchName: '', carryLocalChanges: false }))
      .toEqual({ kind: 'attachTo', base: 'main' })
    expect(workDirChipState({ kind: 'create', baseBranch: 'main', mode: 'detach', branchName: '', carryLocalChanges: false }))
      .toEqual({ kind: 'createFrom', base: 'main' })
  })

  it('keeps the new branch name empty until it is typed', () => {
    expect(workDirChipState({ kind: 'create', baseBranch: 'main', mode: 'branch', branchName: '  ', carryLocalChanges: false }))
      .toEqual({ kind: 'createBranch', name: '' })
  })
})
