/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { SessionGoal } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { applyEventToSession } = await import('./index')

const goal: SessionGoal = {
  objective: 'Ship the login flow',
  status: 'active',
  tokensUsed: 12,
  elapsedMs: 400,
}

/** One field, whichever harness produced the snapshot. */
describe('applyEventToSession: session_goal', () => {
  it('stores a live goal snapshot', () => {
    const session = createDefaultPerSessionState()
    const patch = applyEventToSession(session, { type: 'session_goal', goal })
    expect(patch.sessionGoal).toEqual(goal)
  })

  it('keeps the harness-specific extras a goal carries', () => {
    const session = createDefaultPerSessionState()
    const claudeGoal: SessionGoal = {
      objective: 'All tests pass',
      status: 'active',
      lastReason: 'one suite still red',
    }
    const patch = applyEventToSession(session, { type: 'session_goal', goal: claudeGoal })
    expect(patch.sessionGoal).toEqual(claudeGoal)
  })

  it('clears the snapshot when the goal goes away', () => {
    const session = { ...createDefaultPerSessionState(), sessionGoal: goal }
    const patch = applyEventToSession(session, { type: 'session_goal', goal: null })
    expect(patch.sessionGoal).toBeNull()
  })
})
