import { afterEach, describe, expect, it, vi } from 'vitest'
const settings = vi.hoisted(() => ({ jevFastLoopEnabled: false, computerUseEnabled: true }))
vi.mock('../app-settings-service', () => ({ readAppSettings: () => settings }))
vi.mock('./jev-api-key', () => ({ getJevApiKey: () => 'test-only-key' }))
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { executeComputerUseTool, setComputerUseEnabledForTests } from '../computer-use/tools'
import { executeComputerRun, rootForApp } from './computer-run-tool'
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

  it('launches an app that has no window and waits for its first one, and leaves a running one alone', async () => {
    // Whether the app is running and has a window is a host fact; the caller
    // used to be told to find out with computer_apps first, one model turn
    // per run for nothing.
    const backend = new FakePlatformBackend([
      { app: 'Notes', bundleId: 'com.test.notes', pid: 7, windows: [{ title: 'Scratch', focused: true, tree: { role: 'window' } }] },
      { app: 'Calculator', bundleId: 'com.test.calc', pid: 8, windows: [] },
    ])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    const launch = vi.spyOn(backend, 'launchApp').mockImplementation(async () => {
      // The window appears a moment after launch, as it does for a real app.
      setTimeout(() => backend.reset([
        { app: 'Notes', bundleId: 'com.test.notes', pid: 7, windows: [{ title: 'Scratch', focused: true, tree: { role: 'window' } }] },
        { app: 'Calculator', bundleId: 'com.test.calc', pid: 8, windows: [{ title: 'Calculator', tree: { role: 'window' } }] },
      ]), 30)
    })
    const notes = await rootForApp(service, 'com.test.notes')
    expect(launch).not.toHaveBeenCalled()
    expect((await service.resolveTargetRoot(notes)).bundleId).toBe('com.test.notes')

    const calc = await rootForApp(service, 'com.test.calc', undefined, { pollMs: 10 })
    expect(launch).toHaveBeenCalledWith('com.test.calc')
    expect((await service.resolveTargetRoot(calc)).title).toBe('Calculator')
  })

  it('gives up on an app whose window never comes, with the original error', async () => {
    const backend = new FakePlatformBackend([{ app: 'Calculator', bundleId: 'com.test.calc', pid: 8, windows: [] }])
    const service = new ComputerUseService({ adapter: backend })
    service.policy.setEnabled(true)
    await expect(rootForApp(service, 'com.test.calc', undefined, { timeoutMs: 40, pollMs: 10 })).rejects.toMatchObject({ code: 'UNKNOWN_ROOT' })
  })

  it('never consumes a browser run through computer_run', async () => {
    const run = { runId: 'browser-test', resume: vi.fn() }
    storePausedRun('test', run, Date.now(), 'browser')
    await expect(executeComputerRun('test', { description: 'test', runId: run.runId, answer: { questionId: 'q1', choice: 'abort' } }, new ComputerUseService(), vi.fn())).rejects.toThrow('wrong-platform')
    expect(run.resume).not.toHaveBeenCalled()
  })
})
