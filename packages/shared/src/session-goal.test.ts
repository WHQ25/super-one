import { describe, expect, it } from 'vitest'
import {
  goalComposerAction,
  isGoalLifecycleArg,
  normalizeSessionGoalStatus,
  sessionGoalFromClaudeActive,
} from './session-goal'

describe('normalizeSessionGoalStatus', () => {
  it('accepts the host enum verbatim', () => {
    expect(normalizeSessionGoalStatus('active')).toBe('active')
    expect(normalizeSessionGoalStatus('complete')).toBe('complete')
  })

  it('folds separator and case variants of the wire spelling', () => {
    expect(normalizeSessionGoalStatus('budget_limited')).toBe('budgetLimited')
    expect(normalizeSessionGoalStatus('usage-limited')).toBe('usageLimited')
    expect(normalizeSessionGoalStatus('BudgetLimited')).toBe('budgetLimited')
  })

  it('falls back to paused rather than active for anything unrecognized', () => {
    expect(normalizeSessionGoalStatus('mystery')).toBe('paused')
    expect(normalizeSessionGoalStatus(undefined)).toBe('paused')
    expect(normalizeSessionGoalStatus(42)).toBe('paused')
  })
})

describe('sessionGoalFromClaudeActive', () => {
  it('maps a live condition onto an active goal', () => {
    expect(
      sessionGoalFromClaudeActive({
        condition: 'All tests pass',
        iterations: 3,
        set_at: 1700000000000,
        tokens_at_start: 1200,
        last_reason: 'two suites still red',
      }),
    ).toEqual({
      objective: 'All tests pass',
      status: 'active',
      iterations: 3,
      lastReason: 'two suites still red',
    })
  })

  it('omits the reason until the evaluator has produced one', () => {
    expect(
      sessionGoalFromClaudeActive({
        condition: 'Ship the migration',
        iterations: 0,
        set_at: 1700000000000,
        tokens_at_start: 0,
      }),
    ).toEqual({ objective: 'Ship the migration', status: 'active', iterations: 0 })
  })

  it('treats a cleared or malformed payload as no goal', () => {
    expect(sessionGoalFromClaudeActive(null)).toBeNull()
    expect(sessionGoalFromClaudeActive({ condition: '   ' })).toBeNull()
    expect(sessionGoalFromClaudeActive('nope')).toBeNull()
  })
})

describe('goalComposerAction', () => {
  const GROK_ARGS = ['status', 'pause', 'resume', 'clear']

  it('opens the dialog for a bare /goal and for an objective', () => {
    expect(goalComposerAction('/goal', GROK_ARGS)).toEqual({ type: 'dialog', prefill: '' })
    expect(goalComposerAction('/goal  Fix login', GROK_ARGS)).toEqual({
      type: 'dialog',
      prefill: 'Fix login',
    })
  })

  it('passes the harness lifecycle subcommands through', () => {
    expect(goalComposerAction('/goal pause', GROK_ARGS)).toEqual({ type: 'passthrough' })
    expect(goalComposerAction('/goal STATUS', GROK_ARGS)).toEqual({ type: 'passthrough' })
  })

  it('honours a narrower lifecycle list, so Claude only passes clear through', () => {
    expect(goalComposerAction('/goal clear', ['clear'])).toEqual({ type: 'passthrough' })
    expect(goalComposerAction('/goal pause', ['clear'])).toEqual({
      type: 'dialog',
      prefill: 'pause',
    })
  })

  it('treats a reserved token inside a longer objective as a set', () => {
    expect(goalComposerAction('/goal pause the rollout', GROK_ARGS)).toEqual({
      type: 'dialog',
      prefill: 'pause the rollout',
    })
  })

  it('ignores non-goal lines', () => {
    expect(goalComposerAction('/loop 30m ping', GROK_ARGS)).toBeNull()
    expect(goalComposerAction('goal Fix login', GROK_ARGS)).toBeNull()
  })
})

describe('isGoalLifecycleArg', () => {
  it('matches the whole arg only', () => {
    expect(isGoalLifecycleArg('pause', ['pause'])).toBe(true)
    expect(isGoalLifecycleArg(' pause ', ['pause'])).toBe(true)
    expect(isGoalLifecycleArg('pause now', ['pause'])).toBe(false)
  })

  it('never matches an empty arg, so a bare /goal still opens the dialog', () => {
    expect(isGoalLifecycleArg('', ['clear'])).toBe(false)
  })
})
