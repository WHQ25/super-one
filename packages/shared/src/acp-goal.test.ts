import { describe, expect, it } from 'vitest'
import { normalizeAcpGoalStatus, sessionGoalFromAcp } from './acp-goal'

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

describe('sessionGoalFromAcp', () => {
  it('carries the fields Grok actually reports', () => {
    expect(
      sessionGoalFromAcp({
        goalId: 'g1',
        objective: 'Migrate auth',
        status: 'active',
        tokensUsed: 4200,
        elapsedMs: 61_000,
        phase: 'implementing',
      }),
    ).toEqual({
      objective: 'Migrate auth',
      status: 'active',
      tokensUsed: 4200,
      elapsedMs: 61_000,
      phase: 'implementing',
    })
  })

  it('surfaces a pause message as the shared last-reason field', () => {
    expect(
      sessionGoalFromAcp({
        goalId: 'g1',
        objective: 'Migrate auth',
        status: 'paused',
        tokensUsed: 0,
        elapsedMs: 0,
        pauseMessage: 'waiting on review',
      })?.lastReason,
    ).toBe('waiting on review')
  })

  it('maps a cleared goal to no goal at all', () => {
    expect(
      sessionGoalFromAcp({
        goalId: 'g1',
        objective: 'Migrate auth',
        status: 'cleared',
        tokensUsed: 0,
        elapsedMs: 0,
      }),
    ).toBeNull()
    expect(sessionGoalFromAcp(null)).toBeNull()
  })
})
