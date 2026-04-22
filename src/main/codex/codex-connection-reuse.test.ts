import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: {
      file: {
        getFile: () => ({ path: '/tmp/codex.log' }),
      },
    },
  },
}))

vi.mock('../agent/event-trace', () => ({
  trace: vi.fn(),
}))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

const createHandleMock = vi.fn()
vi.mock('./app-server-connection', async () => {
  const actual = await vi.importActual<typeof import('./app-server-connection')>('./app-server-connection')
  return {
    ...actual,
    createAppServerConnection: (...args: unknown[]) => createHandleMock(...(args as [])),
  }
})

const { CodexExperimentService } = await import('./codex-experiment-service')

function makeFakeHandle() {
  let closed = false
  const closedListeners = new Set<(info: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void>()
  return {
    connection: {
      request: vi.fn<(method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>>()
        .mockResolvedValue({}),
      respond: vi.fn(),
      notify: vi.fn(),
      nextNotification: vi.fn(),
    },
    close: vi.fn(async () => { closed = true }),
    getStderr: () => '',
    onClosed: (cb: (info: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void) => {
      closedListeners.add(cb)
      return () => closedListeners.delete(cb)
    },
    __isClosed: () => closed,
    __fireExit: (info: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => {
      for (const cb of closedListeners) cb(info)
    },
  }
}

describe('Codex session connection reuse', () => {
  beforeEach(() => {
    createHandleMock.mockReset()
  })

  it('creates the app-server process once across multiple sequential runs on the same session', async () => {
    const service = new CodexExperimentService()
    const handle = makeFakeHandle()
    createHandleMock.mockResolvedValue(handle)

    // Stub per-turn internals that we don't need to exercise here.
    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-abc')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-abc', usage: null, items: [] })

    await service.run('sid-reuse', '/project', {
      prompt: 'first',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })
    await service.run('sid-reuse', '/project', {
      prompt: 'second',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })
    await service.run('sid-reuse', '/project', {
      prompt: 'third',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })

    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handle.close).not.toHaveBeenCalled()
  })

  it('tears down and respawns the connection when the session is reset', async () => {
    const service = new CodexExperimentService()
    const handleA = makeFakeHandle()
    const handleB = makeFakeHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)

    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-abc')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-abc', usage: null, items: [] })

    await service.run('sid-reset', '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    service.reset('sid-reset')
    await new Promise((r) => setImmediate(r))
    expect(handleA.close).toHaveBeenCalled()

    await service.run('sid-reset', '/project', { prompt: 'second', model: 'gpt-5.4', permissionPreset: 'default' })
    expect(createHandleMock).toHaveBeenCalledTimes(2)
  })

  it('tears down the connection when auth changes for the project', async () => {
    const service = new CodexExperimentService()
    const handle = makeFakeHandle()
    createHandleMock.mockResolvedValue(handle)

    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-abc')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-abc', usage: null, items: [] })

    await service.run('sid-auth', '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    expect(createHandleMock).toHaveBeenCalledTimes(1)

    service.setAuth('/project', { mode: 'apiKey', apiKey: 'sk-test-1234567890' })
    await new Promise((r) => setImmediate(r))
    expect(handle.close).toHaveBeenCalled()
  })

  it('clears the cached handle when the child process exits', async () => {
    const service = new CodexExperimentService()
    const handleA = makeFakeHandle()
    const handleB = makeFakeHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)

    vi.spyOn(service as any, 'resolveThread').mockResolvedValue('thread-abc')
    vi.spyOn(service as any, 'streamTurnEvents').mockResolvedValue({ threadId: 'thread-abc', usage: null, items: [] })

    await service.run('sid-exit', '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    handleA.__fireExit({ code: 1, signal: null, stderr: 'boom' })

    await service.run('sid-exit', '/project', { prompt: 'second', model: 'gpt-5.4', permissionPreset: 'default' })
    expect(createHandleMock).toHaveBeenCalledTimes(2)
  })
})
