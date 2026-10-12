import { describe, expect, it } from 'vitest'
import { worktreeCwdChange } from './worktree-cwd'

// Shapes captured from SDK 0.3.296 `tool_use_result` (EnterWorktree name="probe", ExitWorktree action="keep").
const entered = {
  worktreePath: '/repo/.claude/worktrees/probe',
  worktreeBranch: 'worktree-probe',
  message: 'Created worktree at /repo/.claude/worktrees/probe on branch worktree-probe.',
}
const exited = {
  action: 'keep',
  originalCwd: '/repo',
  worktreePath: '/repo/.claude/worktrees/probe',
  worktreeBranch: 'worktree-probe',
  restoredCwd: '/repo',
  originalCwdMissing: false,
  message: 'Exited worktree.',
}

describe('worktreeCwdChange', () => {
  it('reads the entered worktree and its branch', () => {
    expect(worktreeCwdChange('EnterWorktree', entered)).toEqual({ cwd: '/repo/.claude/worktrees/probe', gitBranch: 'worktree-probe' })
  })

  it('reads the directory an exit restored, without claiming a branch', () => {
    expect(worktreeCwdChange('ExitWorktree', exited)).toEqual({ cwd: '/repo' })
    expect(worktreeCwdChange('ExitWorktree', { ...exited, restoredCwd: undefined })).toEqual({ cwd: '/repo' })
  })

  it('ignores other tools and results without a directory', () => {
    expect(worktreeCwdChange('Bash', entered)).toBeNull()
    expect(worktreeCwdChange('EnterWorktree', 'Created worktree')).toBeNull()
    expect(worktreeCwdChange('EnterWorktree', { worktreePath: '' })).toBeNull()
  })
})
