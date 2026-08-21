import { describe, expect, it } from 'vitest'
import {
  grokGoalComposerAction,
  isGrokGoalLifecycleArg,
  normalizeAcpGoalStatus,
} from './acp-goal'

describe('normalizeAcpGoalStatus', () => {
  it('maps Grok wire statuses onto the host enum', () => {
    expect(normalizeAcpGoalStatus('active')).toBe('active')
    expect(normalizeAcpGoalStatus('UserPaused')).toBe('paused')
    expect(normalizeAcpGoalStatus('backoff_paused')).toBe('paused')
    expect(normalizeAcpGoalStatus('no-progress-paused')).toBe('paused')
    expect(normalizeAcpGoalStatus('blocked')).toBe('blocked')
    expect(normalizeAcpGoalStatus('budget_limited')).toBe('budgetLimited')
    expect(normalizeAcpGoalStatus('Complete')).toBe('complete')
    expect(normalizeAcpGoalStatus('cleared')).toBe('cleared')
  })

  it('treats unknown statuses as paused', () => {
    expect(normalizeAcpGoalStatus('mystery')).toBe('paused')
  })
})

describe('grokGoalComposerAction', () => {
  it('opens the dialog for a bare /goal and an objective', () => {
    expect(grokGoalComposerAction('/goal')).toEqual({ type: 'dialog', prefill: '' })
    expect(grokGoalComposerAction('/goal  Fix login')).toEqual({
      type: 'dialog',
      prefill: 'Fix login',
    })
  })

  it('passes lifecycle subcommands through', () => {
    expect(grokGoalComposerAction('/goal pause')).toEqual({ type: 'passthrough' })
    expect(grokGoalComposerAction('/goal STATUS')).toEqual({ type: 'passthrough' })
    expect(grokGoalComposerAction('/goal resume')).toEqual({ type: 'passthrough' })
    expect(grokGoalComposerAction('/goal clear')).toEqual({ type: 'passthrough' })
  })

  it('treats a reserved token inside an objective as a set, not lifecycle', () => {
    expect(grokGoalComposerAction('/goal pause the rollout')).toEqual({
      type: 'dialog',
      prefill: 'pause the rollout',
    })
  })

  it('ignores non-goal lines', () => {
    expect(grokGoalComposerAction('/loop 30m ping')).toBeNull()
    expect(grokGoalComposerAction('goal Fix login')).toBeNull()
  })
})

describe('isGrokGoalLifecycleArg', () => {
  it('matches the whole arg only', () => {
    expect(isGrokGoalLifecycleArg('pause')).toBe(true)
    expect(isGrokGoalLifecycleArg(' pause ')).toBe(true)
    expect(isGrokGoalLifecycleArg('pause now')).toBe(false)
  })
})
