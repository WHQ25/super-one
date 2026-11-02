import { describe, expect, it } from 'vitest'
import { tabBelongsToProject, tabShowsInTerminalPanel, terminalCreateSessionId } from './useTerminalSync'

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

describe('terminalCreateSessionId', () => {
  it('passes a local session id and omits a remote draft the node does not own', () => {
    expect(terminalCreateSessionId('/proj', 'draft-1', false)).toBe('draft-1')
    expect(terminalCreateSessionId('/proj', 'draft-1', true)).toBe('draft-1')
    expect(terminalCreateSessionId('remote:env-1:/work/app', 'draft-1', false)).toBeUndefined()
    expect(terminalCreateSessionId('remote:env-1:/work/app', 'node-1', true)).toBe('node-1')
    expect(terminalCreateSessionId('remote:env-1:/work/app', null, false)).toBeUndefined()
  })
})

describe('tabShowsInTerminalPanel', () => {
  it('lists user tabs but not agent-owned or activity-launched ones', () => {
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj' }, '/proj')).toBe(true)
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj', agentSessionId: 's' }, '/proj')).toBe(false)
    expect(tabShowsInTerminalPanel({ cwd: '/proj', projectPath: '/proj', openedInActivity: true }, '/proj')).toBe(false)
  })
})
