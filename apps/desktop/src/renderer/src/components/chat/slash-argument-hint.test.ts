import { describe, it, expect } from 'vitest'
import {
  remainingSlashArgumentHint,
  splitTopLevelAlternatives,
  tokenizeHintBranch,
  remainingTokensForBranch,
} from './slash-argument-hint'

const WORKFLOW_HINT = '<name> [args] | pause|resume|stop|save [name]'
const GOAL_HINT = '<objective> [--budget <tokens>] | status | pause | resume | clear'
const ADD_DIR_HINT = '[project|session] [dir]'

describe('splitTopLevelAlternatives', () => {
  it('splits only on space-padded pipes', () => {
    expect(splitTopLevelAlternatives(WORKFLOW_HINT)).toEqual([
      '<name> [args]',
      'pause|resume|stop|save [name]',
    ])
  })

  it('keeps bare choice groups intact', () => {
    expect(splitTopLevelAlternatives('pause|resume|stop|save [name]')).toEqual([
      'pause|resume|stop|save [name]',
    ])
  })

  it('does not split [project|session]', () => {
    expect(splitTopLevelAlternatives(ADD_DIR_HINT)).toEqual([ADD_DIR_HINT])
  })

  it('splits goal-style multi alts', () => {
    expect(splitTopLevelAlternatives(GOAL_HINT)).toEqual([
      '<objective> [--budget <tokens>]',
      'status',
      'pause',
      'resume',
      'clear',
    ])
  })
})

describe('tokenizeHintBranch', () => {
  it('tokenizes launch branch', () => {
    expect(tokenizeHintBranch('<name> [args]')).toEqual([
      { kind: 'placeholder', raw: '<name>', optional: false },
      { kind: 'placeholder', raw: '[args]', optional: true },
    ])
  })

  it('tokenizes manage choice + optional name', () => {
    expect(tokenizeHintBranch('pause|resume|stop|save [name]')).toEqual([
      {
        kind: 'choice',
        raw: 'pause|resume|stop|save',
        options: ['pause', 'resume', 'stop', 'save'],
        optional: false,
      },
      { kind: 'placeholder', raw: '[name]', optional: true },
    ])
  })

  it('keeps bracket choice as one placeholder', () => {
    expect(tokenizeHintBranch(ADD_DIR_HINT)).toEqual([
      { kind: 'placeholder', raw: '[project|session]', optional: true },
      { kind: 'placeholder', raw: '[dir]', optional: true },
    ])
  })
})

describe('remainingSlashArgumentHint — positional', () => {
  it('slices simple placeholders by filled count', () => {
    expect(remainingSlashArgumentHint('[channel] [bump]', [])).toBe('[channel] [bump]')
    expect(remainingSlashArgumentHint('[channel] [bump]', ['alpha'])).toBe('[bump]')
    expect(remainingSlashArgumentHint('[channel] [bump]', ['alpha', 'beta'])).toBeNull()
  })

  it('handles add-dir style bracket choices as positional', () => {
    expect(remainingSlashArgumentHint(ADD_DIR_HINT, [])).toBe('[project|session] [dir]')
    expect(remainingSlashArgumentHint(ADD_DIR_HINT, ['project'])).toBe('[dir]')
  })
})

describe('remainingSlashArgumentHint — /workflow grammar', () => {
  it('shows full grammar with no args', () => {
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, [])).toBe(WORKFLOW_HINT)
  })

  it('launch path: name then optional args', () => {
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['review-changes'])).toBe('[args]')
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['review-changes', '{"x":1}'])).toBeNull()
  })

  it('manage path: op then optional name', () => {
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['pause'])).toBe('[name]')
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['stop', 'review-changes-2'])).toBeNull()
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['resume'])).toBe('[name]')
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['save', 'review-changes'])).toBeNull()
  })

  it('manage path name-first: name then op', () => {
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['review-changes', 'pause'])).toBeNull()
    expect(remainingSlashArgumentHint(WORKFLOW_HINT, ['review-changes', 'stop'])).toBeNull()
  })
})

describe('remainingSlashArgumentHint — /goal grammar', () => {
  it('shows full grammar empty, then launch remainder', () => {
    expect(remainingSlashArgumentHint(GOAL_HINT, [])).toBe(GOAL_HINT)
    expect(remainingSlashArgumentHint(GOAL_HINT, ['ship auth'])).toBe('[--budget <tokens>]')
  })

  it('status/pause/resume/clear consume the branch', () => {
    expect(remainingSlashArgumentHint(GOAL_HINT, ['status'])).toBeNull()
    expect(remainingSlashArgumentHint(GOAL_HINT, ['pause'])).toBeNull()
    expect(remainingSlashArgumentHint(GOAL_HINT, ['clear'])).toBeNull()
  })
})

describe('remainingTokensForBranch', () => {
  it('matches sequential placeholders and reports remaining', () => {
    const tokens = tokenizeHintBranch('<a> [b] <c>')
    expect(remainingTokensForBranch(tokens, ['x', 'y'])).toEqual({
      remaining: ['<c>'],
      score: 2,
    })
  })

  it('scores choice matches higher than placeholders', () => {
    const manage = tokenizeHintBranch('pause|resume|stop|save [name]')
    const launch = tokenizeHintBranch('<name> [args]')
    const pauseOnManage = remainingTokensForBranch(manage, ['pause'])
    const pauseOnLaunch = remainingTokensForBranch(launch, ['pause'])
    expect(pauseOnManage!.score).toBeGreaterThan(pauseOnLaunch!.score)
    expect(pauseOnManage!.remaining).toEqual(['[name]'])
  })
})
