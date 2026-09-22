import { describe, expect, it } from 'vitest'
import { tabBelongsToProject, tabShowsInTerminalPanel } from './useTerminalSync'

describe('tabBelongsToProject', () => {
  it('matches by projectPath even when cwd is a sibling worktree', () => {
    expect(tabBelongsToProject(
      { cwd: '/worktrees/feat', projectPath: '/proj' },
      '/proj',
    )).toBe(true)
    expect(tabBelongsToProject(
      { cwd: '/other', projectPath: '/other' },
      '/proj',
    )).toBe(false)
  })

  it('falls back to cwd prefix when projectPath is missing', () => {
    expect(tabBelongsToProject({ cwd: '/proj/.worktrees/feat' }, '/proj')).toBe(true)
    expect(tabBelongsToProject({ cwd: '/proj' }, '/proj')).toBe(true)
    expect(tabBelongsToProject({ cwd: '/proj-other' }, '/proj')).toBe(false)
  })
})

describe('tabShowsInTerminalPanel', () => {
  it('lists user tabs but not agent-owned or activity-launched ones', () => {
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj' }, '/proj')).toBe(true)
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj', agentSessionId: 's' }, '/proj')).toBe(false)
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj', openedInActivity: true }, '/proj')).toBe(false)
  })
})
