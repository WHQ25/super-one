import { describe, expect, it } from 'vitest'
import {
  goalComposerAction,
  goalMessageObjective,
  isGoalLifecycleArg,
  sessionGoalFromClaudeActive,
} from './session-goal'

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
    ).toEqual({ objective: 'Ship the migration', status: 'active' })
  })

  it('treats a cleared or malformed payload as no goal', () => {
    expect(sessionGoalFromClaudeActive(null)).toBeNull()
    expect(sessionGoalFromClaudeActive({ condition: '   ' })).toBeNull()
    expect(sessionGoalFromClaudeActive('nope')).toBeNull()
  })
})

describe('goalComposerAction', () => {
  const GROK_ARGS = ['status', 'pause', 'resume', 'clear']

  it('enters goal mode for a bare /goal and sets an inline objective', () => {
    expect(goalComposerAction('/goal', GROK_ARGS)).toEqual({ type: 'compose' })
    expect(goalComposerAction('/goal  ', GROK_ARGS)).toEqual({ type: 'compose' })
    expect(goalComposerAction('/goal  Fix login', GROK_ARGS)).toEqual({
      type: 'set',
      objective: 'Fix login',
    })
  })

  it('passes the harness lifecycle subcommands through', () => {
    expect(goalComposerAction('/goal pause', GROK_ARGS)).toEqual({ type: 'passthrough' })
    expect(goalComposerAction('/goal STATUS', GROK_ARGS)).toEqual({ type: 'passthrough' })
  })

  it('honours a narrower lifecycle list, so Claude only passes clear through', () => {
    expect(goalComposerAction('/goal clear', ['clear'])).toEqual({ type: 'passthrough' })
    expect(goalComposerAction('/goal pause', ['clear'])).toEqual({
      type: 'set',
      objective: 'pause',
    })
  })

  it('treats a reserved token inside a longer objective as a set', () => {
    expect(goalComposerAction('/goal pause the rollout', GROK_ARGS)).toEqual({
      type: 'set',
      objective: 'pause the rollout',
    })
  })

  it('ignores non-goal lines', () => {
    expect(goalComposerAction('/loop 30m ping', GROK_ARGS)).toBeNull()
    expect(goalComposerAction('goal Fix login', GROK_ARGS)).toBeNull()
  })
})

describe('goalMessageObjective', () => {
  it('returns the objective of a sent /goal line', () => {
    expect(goalMessageObjective('/goal Ship login')).toBe('Ship login')
    expect(goalMessageObjective('/goal  pause the rollout ')).toBe('pause the rollout')
  })

  it('is null for prompts, a bare /goal and every harness lifecycle token', () => {
    expect(goalMessageObjective('Ship login')).toBeNull()
    expect(goalMessageObjective('/goal')).toBeNull()
    expect(goalMessageObjective('/goal clear')).toBeNull()
    expect(goalMessageObjective('/goal pause')).toBeNull()
    expect(goalMessageObjective('/goal STATUS')).toBeNull()
  })
})

describe('isGoalLifecycleArg', () => {
  it('matches the whole arg only', () => {
    expect(isGoalLifecycleArg('pause', ['pause'])).toBe(true)
    expect(isGoalLifecycleArg(' pause ', ['pause'])).toBe(true)
    expect(isGoalLifecycleArg('pause now', ['pause'])).toBe(false)
  })

  it('never matches an empty arg, so a bare /goal still enters goal mode', () => {
    expect(isGoalLifecycleArg('', ['clear'])).toBe(false)
  })
})
