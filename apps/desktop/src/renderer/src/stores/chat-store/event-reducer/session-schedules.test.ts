/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { applyEventToSession } = await import('./index')

describe('applyEventToSession: session_schedules', () => {
  it('starts empty and replaces the whole set on every report', () => {
    const session = createDefaultPerSessionState()
    expect(session.sessionSchedules).toEqual([])
    const schedules = [{ id: 'c1', schedule: '*/30 * * * *', recurring: true, prompt: 'ping' }]
    const patch = applyEventToSession(session, { type: 'session_schedules', schedules })
    expect(patch.sessionSchedules).toEqual(schedules)
    expect(applyEventToSession({ ...session, ...patch }, { type: 'session_schedules', schedules: [] }).sessionSchedules).toEqual([])
  })
})
