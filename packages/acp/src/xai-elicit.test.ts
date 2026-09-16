import { describe, expect, it } from 'vitest'
import {
  formatGrokAskUserAccepted,
  formatGrokAskUserCancelled,
  formatGrokElicitOutcome,
  formatGrokExitPlanCancelled,
  formatGrokExitPlanFromDecision,
  formatGrokScheduledTaskPrompt,
  grokElicitToPendingInteraction,
  parseGrokElicitComplete,
  parseGrokScheduledInject,
} from './xai-elicit'

describe('grokElicitToPendingInteraction', () => {
  it('parks a URL elicit with requestKind mcp_elicitation', () => {
    const parsed = grokElicitToPendingInteraction({
      serverName: 'github',
      message: 'Sign in',
      url: 'https://github.com/login',
      elicitationId: 'e-1',
      toolCallId: 'tc-1',
    })
    expect(parsed?.elicitationId).toBe('e-1')
    expect(parsed?.interaction).toMatchObject({
      interactionId: 'tc-1',
      kind: 'permission',
      requestKind: 'mcp_elicitation',
      serverName: 'github',
      input: { elicitationUrl: 'https://github.com/login', elicitationId: 'e-1' },
    })
  })

  it('returns cancel/accept outcomes', () => {
    expect(formatGrokElicitOutcome(true)).toEqual({ outcome: 'accept' })
    expect(formatGrokElicitOutcome(false)).toEqual({ outcome: 'cancel' })
  })
})

describe('scheduled inject', () => {
  it('parses and frames the prompt', () => {
    expect(parseGrokScheduledInject({ prompt: 'do it', taskId: 't1', humanSchedule: '5m' })).toEqual({
      prompt: 'do it',
      taskId: 't1',
      humanSchedule: '5m',
    })
    const framed = formatGrokScheduledTaskPrompt('do it', 't1', '5m')
    expect(framed).toContain('<system-reminder>')
    expect(framed.endsWith('do it')).toBe(true)
  })

  it('reads elicit complete ids', () => {
    expect(parseGrokElicitComplete({ elicitation_id: 'e-1' })).toEqual({ elicitationId: 'e-1' })
    expect(parseGrokElicitComplete({})).toBeNull()
  })
})

describe('ask / exit_plan fail-closed formatters', () => {
  it('cancels ask when answers are missing', () => {
    expect(formatGrokAskUserCancelled()).toEqual({ outcome: 'cancelled' })
    expect(formatGrokAskUserAccepted(null)).toEqual({ outcome: 'cancelled' })
    expect(formatGrokAskUserAccepted({ 'Q?': ['A'] })).toEqual({
      outcome: 'accepted',
      answers: { 'Q?': ['A'] },
    })
  })

  it('unwraps remote answers and preserves annotations', () => {
    expect(formatGrokAskUserAccepted({
      answers: { 'Which?': 'A, B' },
      annotations: { 'Which?': { notes: 'Both' } },
    })).toEqual({
      outcome: 'accepted', answers: { 'Which?': ['A', 'B'] },
      annotations: { 'Which?': { notes: 'Both' } },
    })
    expect(formatGrokAskUserAccepted({})).toEqual({ outcome: 'cancelled' })
    expect(formatGrokAskUserAccepted({ answers: {} })).toEqual({ outcome: 'cancelled' })
    expect(formatGrokAskUserAccepted({ answers: { 'Q?': {} } })).toEqual({ outcome: 'cancelled' })
  })

  it('maps plan approve/reject onto Grok outcomes', () => {
    expect(formatGrokExitPlanFromDecision('approve')).toEqual({ outcome: 'approved' })
    expect(formatGrokExitPlanFromDecision('reject', { feedback: 'nope' })).toEqual({
      outcome: 'cancelled',
      feedback: 'nope',
    })
    expect(formatGrokExitPlanCancelled()).toEqual({ outcome: 'cancelled' })
  })
})
