import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendStartOptions } from '../types'

const runtime = vi.hoisted(() => ({
  createAgent: vi.fn(),
  setPermissionPreset: vi.fn(),
  setPlanMode: vi.fn(),
  hasBackgroundWork: vi.fn(() => false),
  stopTask: vi.fn(() => true),
  stopBackgroundWork: vi.fn(),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../deepseek/deepseek-runtime-host', () => ({
  DEEPSEEK_DEFAULT_PROVIDER: 'deepseek-official',
  DEEPSEEK_DEFAULT_MODEL: 'deepseek-v4-pro',
  getDeepseekRuntime: async () => runtime,
  registerApprovalRouter: () => () => {},
}))

import { DeepseekBackend } from './deepseek-backend'

const cancel = vi.fn()

async function startBackend() {
  runtime.createAgent.mockImplementation(async (options: { sessionId: string }) => ({
    sessionId: options.sessionId,
    sendText: async () => {},
    steerText: async () => {},
    setRoute: () => {},
    cancel,
    whenIdle: async () => {},
    status: () => 'idle' as const,
    dispose: async () => {},
  }))
  const backend = new DeepseekBackend()
  const opts: BackendStartOptions = {
    sessionId: 's1',
    projectPath: '/tmp/p',
    cwd: '/tmp/p',
    config: {},
    permissionMode: 'default',
    providerSessionId: 'dsh-1',
    abortController: new AbortController(),
  }
  await backend.start(opts)
  return backend
}

describe('DeepseekBackend background tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports no background work before an agent exists', () => {
    expect(new DeepseekBackend().hasActiveBackgroundTasks()).toBe(false)
  })

  it('reports the runtime\'s background work for its own session', async () => {
    const backend = await startBackend()
    runtime.hasBackgroundWork.mockReturnValue(true)

    expect(backend.hasActiveBackgroundTasks()).toBe(true)
    expect(runtime.hasBackgroundWork).toHaveBeenCalledWith('dsh-1')
  })

  it('stops one task from the background list', async () => {
    const backend = await startBackend()

    await backend.stopTask('bash-1')

    expect(runtime.stopTask).toHaveBeenCalledWith('dsh-1', 'bash-1')
  })

  it('stops the turn and its background work on interrupt', async () => {
    const backend = await startBackend()

    await backend.interrupt()

    expect(cancel).toHaveBeenCalled()
    expect(runtime.stopBackgroundWork).toHaveBeenCalledWith('dsh-1')
  })

  it('stops background work when the session is archived', async () => {
    const backend = await startBackend()

    await backend.stopBackgroundTasks()

    expect(runtime.stopBackgroundWork).toHaveBeenCalledWith('dsh-1')
    expect(cancel).not.toHaveBeenCalled()
  })
})
