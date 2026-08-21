/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { AcpGoal } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { applyEventToSession } = await import('./index')

const goal: AcpGoal = {
  goalId: 'g1',
  objective: 'Ship the login flow',
  status: 'active',
  tokensUsed: 12,
  elapsedMs: 400,
}

describe('applyEventToSession: acp_goal', () => {
  it('stores a live Grok goal snapshot', () => {
    const session = createDefaultPerSessionState()
    const patch = applyEventToSession(session, { type: 'acp_goal', goal })
    expect(patch.acpGoal).toEqual(goal)
  })

  it('clears the snapshot when the agent clears the goal', () => {
    const session = { ...createDefaultPerSessionState(), acpGoal: goal }
    const patch = applyEventToSession(session, { type: 'acp_goal', goal: null })
    expect(patch.acpGoal).toBeNull()
  })
})
