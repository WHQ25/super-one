import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getProviderByIdRaw: vi.fn(() => undefined),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

const { createHandleMock } = vi.hoisted(() => ({
  createHandleMock: vi.fn(),
}))

vi.mock('./app-server-connection', async () => {
  const actual = await vi.importActual<typeof import('./app-server-connection')>('./app-server-connection')
  return {
    ...actual,
    createAppServerConnection: (...args: unknown[]) => createHandleMock(...args),
  }
})

const { CodexExperimentService } = await import('./codex-experiment-service')
const { getActiveProviderRaw, getProviderByIdRaw } = await import('../database')

function codexProviderRow(id: string, baseUrl: string) {
  return {
    id,
    name: id,
    api_key: 'sk',
    agent_configs: JSON.stringify({ codex: { base_url: baseUrl } }),
  }
}

function makeModelHandle() {
  return {
    connection: {
      request: vi.fn(async (method: string) => {
        if (method === 'model/list') {
          return {
            data: [{
              id: 'gpt-test',
              model: 'gpt-test',
              displayName: 'GPT Test',
              supportedReasoningEfforts: [],
            }],
          }
        }
        return {}
      }),
      respond: vi.fn(),
      notify: vi.fn(),
      nextNotification: vi.fn(),
    },
    close: vi.fn(async () => {}),
    getStderr: () => '',
    onClosed: vi.fn(() => () => {}),
  }
}

describe('CodexExperimentService auth state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createHandleMock.mockReset()
    vi.mocked(getActiveProviderRaw).mockReturnValue(null as never)
    vi.mocked(getProviderByIdRaw).mockReturnValue(undefined as never)
  })

  it('setAuth emits onAuthChanged event for listeners on the same project', () => {
    const service = new CodexExperimentService()
    const listener = vi.fn()
    const otherListener = vi.fn()
    service.onAuthChanged('/project', listener)
    service.onAuthChanged('/other', otherListener)

    service.setAuth('/project', { mode: 'chatgpt' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(otherListener).not.toHaveBeenCalled()
  })

  it('getAuthStatus reports configured mode and resolved state (isRunning is always false at service level)', () => {
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })
    const status = service.getAuthStatus('/project')
    expect(status.mode).toBe('chatgpt')
    expect(status.isRunning).toBe(false)
  })

  it('getProjectAuth returns a default auto auth for unknown projects', () => {
    const service = new CodexExperimentService()
    expect(service.getProjectAuth('/unknown').mode).toBe('auto')
  })

  it('closeProject clears listeners and emits one final auth-changed event', () => {
    const service = new CodexExperimentService()
    const listener = vi.fn()
    service.onAuthChanged('/project', listener)
    service.setAuth('/project', { mode: 'chatgpt' })
    expect(listener).toHaveBeenCalledTimes(1)

    service.closeProject('/project')
    expect(listener).toHaveBeenCalledTimes(2)

    service.setAuth('/project', { mode: 'chatgpt' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('serves repeated model lists from the per-provider cache and reuses one connection on force-refresh', async () => {
    const handle = makeModelHandle()
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    await service.listModels('/project')
    // Second call is served from the per-provider cache: no extra model/list request.
    expect(handle.connection.request).toHaveBeenCalledTimes(1)

    // A forced refresh bypasses the cache but reuses the same metadata connection.
    await service.listModels('/project', null, true)
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handle.connection.request).toHaveBeenCalledTimes(2)
    expect(handle.close).not.toHaveBeenCalled()

    service.dispose()
    await new Promise((r) => setImmediate(r))
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it('caches models per active codex provider and refetches with new -c overrides when the provider changes', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p1', 'https://a.example.com/v1') as never)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
    // spawn carried the provider as -c overrides
    const cliArgs = createHandleMock.mock.calls[0][3] as string[]
    expect(cliArgs).toContain('model_provider=superone_custom')
    expect(cliArgs).toContain('model_providers.superone_custom.base_url="https://a.example.com/v1"')

    // Switch active provider → different signature → fresh connection + fetch
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p2', 'https://b.example.com/v1') as never)
    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleA.close).toHaveBeenCalledTimes(1)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
  })

  it('caches per session apiProviderId: same id hits cache, different id refetches with that provider', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getProviderByIdRaw).mockImplementation(((id: string) =>
      id === 'sess-a'
        ? codexProviderRow('sess-a', 'https://a/v1')
        : codexProviderRow('sess-b', 'https://b/v1')) as never)
    const service = new CodexExperimentService()

    await service.listModels('/project', 'sess-a')
    await service.listModels('/project', 'sess-a')
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
    expect(createHandleMock.mock.calls[0][3]).toContain('model_providers.superone_custom.base_url="https://a/v1"')

    await service.listModels('/project', 'sess-b')
    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
    expect(createHandleMock.mock.calls[1][3]).toContain('model_providers.superone_custom.base_url="https://b/v1"')
  })

  it('handleProviderChanged clears the model cache and closes metadata connections', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p1', 'https://a.example.com/v1') as never)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(1)

    service.handleProviderChanged()
    await new Promise((r) => setImmediate(r))
    expect(handleA.close).toHaveBeenCalledTimes(1)

    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
  })

  it('closes the cached metadata connection when auth changes', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    service.setAuth('/project', { mode: 'chatgpt' })
    await new Promise((r) => setImmediate(r))
    await service.listModels('/project')

    expect(handleA.close).toHaveBeenCalledTimes(1)
    expect(createHandleMock).toHaveBeenCalledTimes(2)
  })

  it('allows a prewarmed project app-server to be claimed by a Codex backend', async () => {
    const handle = makeModelHandle()
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()

    service.prewarmAppServerConnection('/project')
    const claimed = await service.takeAppServerConnection('/project', { mode: 'auto' })

    expect(claimed).toBe(handle)
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handle.close).not.toHaveBeenCalled()
  })

  it('accepts a released idle app-server handle for the next project claim', async () => {
    const handle = makeModelHandle()
    const service = new CodexExperimentService()

    service.releaseAppServerConnection('/project', { mode: 'auto' }, handle)
    const claimed = await service.takeAppServerConnection('/project', { mode: 'auto' })

    expect(claimed).toBe(handle)
    expect(createHandleMock).not.toHaveBeenCalled()
    expect(handle.close).not.toHaveBeenCalled()
  })
})
