import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../providers/resolver', () => ({ resolveChatService: vi.fn(() => null) }))

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

const { createCodexSession } = await import('./codex-session')
const { runCodexTurn, closeSessionConnection, resetCodexSession } = await import('./codex-turn')
const { CodexExperimentService } = await import('./codex-experiment-service')
const { isCodexBrowserAndComputerUseDenied } = await import('./codex-managed-capability-policy')

function makeFakeHandle(requirements: Record<string, unknown> | null = null) {
  let closed = false
  const closedListeners = new Set<(info: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void>()
  const completeImmediately = async () => ({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
  return {
    connection: {
      request: vi.fn<(method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>>()
        .mockImplementation(async (method: string) => {
          if (method === 'configRequirements/read') return { requirements }
          if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread-abc' } }
          if (method === 'turn/start') return { turn: { id: 'turn-1' } }
          return {}
        }),
      respond: vi.fn(),
      notify: vi.fn(),
      nextNotification: vi.fn().mockImplementation(completeImmediately),
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
  const activeSessions: Parameters<typeof closeSessionConnection>[0][] = []
  const trackSession = <T extends Parameters<typeof closeSessionConnection>[0]>(s: T): T => {
    activeSessions.push(s)
    return s
  }

  beforeEach(() => {
    createHandleMock.mockReset()
  })

  afterEach(async () => {
    while (activeSessions.length > 0) {
      const s = activeSessions.pop()
      if (s) await closeSessionConnection(s).catch(() => {})
    }
  })

  it('creates the app-server process once across multiple sequential runs on the same session', async () => {
    const handle = makeFakeHandle()
    createHandleMock.mockResolvedValue(handle)

    const session = trackSession(createCodexSession('/project', 'gpt-5.4', undefined, undefined, 'default'))
    const auth = { mode: 'auto' as const }

    await runCodexTurn(session, auth, '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    handle.connection.nextNotification.mockImplementation(async () => ({ method: 'turn/completed', params: { turn: { status: 'completed' } } }))
    await runCodexTurn(session, auth, '/project', { prompt: 'second', model: 'gpt-5.4', permissionPreset: 'default' })
    handle.connection.nextNotification.mockImplementation(async () => ({ method: 'turn/completed', params: { turn: { status: 'completed' } } }))
    await runCodexTurn(session, auth, '/project', { prompt: 'third', model: 'gpt-5.4', permissionPreset: 'default' })

    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handle.close).not.toHaveBeenCalled()
  })

  it('loads managed browser and computer policy before starting the Codex thread and clears it on close', async () => {
    const handle = makeFakeHandle({ allowBrowserAndComputerUse: false })
    createHandleMock.mockResolvedValue(handle)
    const session = trackSession(createCodexSession('/project', 'gpt-5.4', undefined, undefined, 'default'))

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'policy check',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })

    const methods = handle.connection.request.mock.calls.map(([method]) => method)
    expect(methods.indexOf('configRequirements/read')).toBeGreaterThanOrEqual(0)
    expect(methods.indexOf('configRequirements/read')).toBeLessThan(methods.indexOf('thread/start'))
    expect(isCodexBrowserAndComputerUseDenied(session.superoneSessionId)).toBe(true)

    await closeSessionConnection(session)
    expect(isCodexBrowserAndComputerUseDenied(session.superoneSessionId)).toBe(false)
  })

  it('tears down and respawns the connection when the session is reset', async () => {
    const handleA = makeFakeHandle()
    const handleB = makeFakeHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)

    const session = trackSession(createCodexSession('/project', 'gpt-5.4', undefined, undefined, 'default'))
    const auth = { mode: 'auto' as const }

    await runCodexTurn(session, auth, '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    resetCodexSession(session)
    await new Promise((r) => setImmediate(r))
    expect(handleA.close).toHaveBeenCalled()

    await runCodexTurn(session, auth, '/project', { prompt: 'second', model: 'gpt-5.4', permissionPreset: 'default' })
    expect(createHandleMock).toHaveBeenCalledTimes(2)
  })

  it('closeSessionConnection from an onAuthChanged subscriber terminates the connection', async () => {
    const handle = makeFakeHandle()
    createHandleMock.mockResolvedValue(handle)

    const service = new CodexExperimentService()
    const session = trackSession(createCodexSession('/project', 'gpt-5.4', undefined, undefined, 'default'))

    const unsub = service.onAuthChanged('/project', () => {
      void closeSessionConnection(session)
    })
    try {
      await runCodexTurn(session, service.getProjectAuth('/project'), '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
      expect(createHandleMock).toHaveBeenCalledTimes(1)

      service.setAuth('/project', { mode: 'apiKey', apiKey: 'sk-test-1234567890' })
      await new Promise((r) => setImmediate(r))
      expect(handle.close).toHaveBeenCalled()
    } finally {
      unsub()
    }
  })

  it('clears the cached handle when the child process exits', async () => {
    const handleA = makeFakeHandle()
    const handleB = makeFakeHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)

    const session = trackSession(createCodexSession('/project', 'gpt-5.4', undefined, undefined, 'default'))
    const auth = { mode: 'auto' as const }
    await runCodexTurn(session, auth, '/project', { prompt: 'first', model: 'gpt-5.4', permissionPreset: 'default' })
    handleA.__fireExit({ code: 1, signal: null, stderr: 'boom' })

    await runCodexTurn(session, auth, '/project', { prompt: 'second', model: 'gpt-5.4', permissionPreset: 'default' })
    expect(createHandleMock).toHaveBeenCalledTimes(2)
  })
})
