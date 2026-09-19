import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ settings: { jevFastLoopEnabled: false }, ask: vi.fn() }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => state.settings }))
vi.mock('./jev-api-key', () => ({ getJevApiKey: () => 'test-only-key' }))
vi.mock('./run-tool-common', async (original) => ({
  ...await original<typeof import('./run-tool-common')>(), jevClient: () => ({ ask: state.ask }),
}))
vi.mock('../ios-simulator', () => ({ getIosSimulatorManager: () => ({ devicesOf: () => [] }) }))
vi.mock('../device/android', () => ({ getAndroidDeviceManager: () => null }))
vi.mock('../device/ios-mirror', () => ({ getMirrorDeviceManager: () => null }))
vi.mock('../device-agent/control', () => ({ requestDeviceControl: vi.fn() }))
import { executeDeviceAgentTool, setDeviceAgentBackendFactory } from '../device-agent'
import { requestDeviceControl } from '../device-agent/control'
import { FakeDeviceBackend } from '../device-agent/fake-backend.test-support'
import { executeDeviceRun } from './device-run-tool'
import { clearPausedRuns, storePausedRun } from './run-store'
import { noul, pick } from './test-fixtures'
import type { JevRequest } from './typesafe-client'

afterEach(() => { clearPausedRuns(); state.settings.jevFastLoopEnabled = false; vi.clearAllMocks() })

describe('device_run tool boundary', () => {
  it('fails the gate or missing control with no input, no Jev request and no control prompt', async () => {
    expect((await executeDeviceAgentTool('test', 'device_run', { description: 'test', goal: 'test' })).isError).toBe(true)
    state.settings.jevFastLoopEnabled = true
    const run = await executeDeviceAgentTool('test', 'device_run', { description: 'test', goal: 'test' })
    const act = await executeDeviceAgentTool('test', 'device_act', { stateId: 'none', actions: [] })
    expect(run).toEqual(act)
    expect(run.content[0].text).toContain('NO_DEVICE')
    expect(requestDeviceControl).not.toHaveBeenCalled()
    expect(state.ask).not.toHaveBeenCalled()
  })

  it('rejects invalid goals and conditions before resolving the device', async () => {
    const resolve = vi.fn()
    for (const args of [{}, { goal: 'test', done_when: { kind: 'notExists', text: 'Loading' } }]) {
      await expect(executeDeviceRun('test', { description: 'test', ...args }, resolve)).rejects.toThrow()
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects a paused run from another platform without consuming it', async () => {
    const run = { runId: 'computer-test', resume: vi.fn() }
    storePausedRun('test', run, Date.now(), 'computer')
    await expect(executeDeviceRun('test', { description: 'test', runId: run.runId, answer: { questionId: 'q1', choice: 'abort' } }, vi.fn())).rejects.toThrow('wrong-platform')
    expect(run.resume).not.toHaveBeenCalled()
  })

  it('refuses a resumed run after its device session was replaced', async () => {
    state.settings.jevFastLoopEnabled = true
    const backend = new FakeDeviceBackend([{ ref: '@e0', role: 'screen', bounds: [0, 0, 1, 1], children: [
      { ref: '@e1', role: 'button', label: 'Publish', bounds: [0.1, 0.2, 0.5, 0.1] },
    ] }])
    setDeviceAgentBackendFactory(() => backend)
    state.ask.mockImplementation(async (request: JevRequest) => ({ answers: {
      goal_satisfied: noul(0), still_loading: noul(0), action: pick('none_useful', Object.keys(request.questions.action.criteria!)),
    }, model: 'test', usage: {}, latencyMs: 1 }))
    const paused = JSON.parse((await executeDeviceAgentTool('test', 'device_run', { description: 'test', goal: 'Publish' })).content[0].text)
    expect(paused.status).toBe('paused')
    setDeviceAgentBackendFactory(() => backend)
    const resumed = await executeDeviceAgentTool('test', 'device_run', {
      description: 'test', runId: paused.runId, answer: { questionId: paused.question.id, choice: '1' },
    })
    expect(resumed.isError).toBe(true)
    expect(resumed.content[0].text).toContain('STALE_STATE')
    expect(backend.performed).toEqual([])
    expect(requestDeviceControl).not.toHaveBeenCalled()
  })
})
