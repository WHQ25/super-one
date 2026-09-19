import { afterEach, describe, expect, it, vi } from 'vitest'
const settings = vi.hoisted(() => ({ jevFastLoopEnabled: false, computerUseEnabled: true }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => settings }))
vi.mock('./jev-api-key', () => ({ getJevApiKey: () => 'test-only-key' }))
import { ComputerUseService } from '../computer-use/computer-use-service'
import { executeComputerUseTool, setComputerUseEnabledForTests } from '../computer-use/tools'
import { executeComputerRun } from './computer-run-tool'
import { clearPausedRuns, storePausedRun } from './run-store'

afterEach(() => { clearPausedRuns(); setComputerUseEnabledForTests(null); settings.jevFastLoopEnabled = false })
describe('computer_run tool boundary', () => {
  it('checks the computer gate and Jev setting before opening or observing an app', async () => {
    const getService = vi.fn(() => new ComputerUseService())
    setComputerUseEnabledForTests(false)
    expect((await executeComputerUseTool('test', 'computer_run', { description: 'test', goal: 'test' }, { host: { getService } })).isError).toBe(true)
    setComputerUseEnabledForTests(true)
    expect((await executeComputerUseTool('test', 'computer_run', { description: 'test', goal: 'test' }, { host: { getService } })).isError).toBe(true)
    expect(getService).not.toHaveBeenCalled()
  })

  it('rejects invalid start/condition arguments before target resolution', async () => {
    const resolve = vi.fn()
    const service = new ComputerUseService()
    for (const args of [{}, { goal: 'x', app: 'A', root: '@r1' }, { goal: 'x', done_when: { kind: 'valueEquals', ref: '@e1' } }]) {
      await expect(executeComputerRun('test', { description: 'test', ...args }, service, resolve)).rejects.toThrow()
    }
    expect(resolve).not.toHaveBeenCalled()
  })

  it('never consumes a browser run through computer_run', async () => {
    const run = { runId: 'browser-test', resume: vi.fn() }
    storePausedRun('test', run, Date.now(), 'browser')
    await expect(executeComputerRun('test', { description: 'test', runId: run.runId, answer: { questionId: 'q1', choice: 'abort' } }, new ComputerUseService(), vi.fn())).rejects.toThrow('wrong-platform')
    expect(run.resume).not.toHaveBeenCalled()
  })
})
