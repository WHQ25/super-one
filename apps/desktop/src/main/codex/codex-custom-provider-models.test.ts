import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appServerMock, providerOverrideMock, resolveServiceMock } = vi.hoisted(() => ({
  appServerMock: vi.fn(),
  providerOverrideMock: vi.fn(() => ({})),
  resolveServiceMock: vi.fn(),
}))

vi.mock('../providers/resolver', () => ({
  resolveChatService: (...args: unknown[]) => resolveServiceMock(...args),
}))

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { getFile: () => ({ path: '/tmp/codex.log' }) } },
  },
}))

vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))

vi.mock('../agent/resolve-cli', () => ({ getNodeRuntime: vi.fn(() => ({})) }))

vi.mock('./app-server-connection', async () => {
  const actual = await vi.importActual<typeof import('./app-server-connection')>('./app-server-connection')
  return {
    ...actual,
    createAppServerConnection: (...args: unknown[]) => appServerMock(...args),
    getCodexProviderOverrideFor: (...args: unknown[]) => providerOverrideMock(...args),
  }
})

const { CodexExperimentService } = await import('./codex-experiment-service')

function provider(apiKey = 'test-key') {
  return {
    platformId: 'test',
    brand: 'Test Provider',
    planId: 'api',
    endpointId: 'openai',
    credentialId: 'credential-id',
    task: 'chat',
    protocol: 'openai-chat',
    baseUrl: 'https://provider.example/v1',
    apiKey,
    auth: 'api-key',
    models: [],
  }
}

function modelsResponse(...ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 })
}

describe('Codex custom provider model discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    providerOverrideMock.mockReturnValue({})
    resolveServiceMock.mockReturnValue(provider())
  })

  it('fetches provider models with bearer auth and caches the successful response', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://provider.example/v1/models')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
      return modelsResponse('provider-model')
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new CodexExperimentService()

    expect((await service.listModels('/project')).map((model) => model.id)).toEqual(['provider-model'])
    await service.listModels('/project')
    await service.listModels('/project', null, true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(appServerMock).not.toHaveBeenCalled()
  })

  it('adds cached Codex reasoning metadata for NewAPI-compatible providers', async () => {
    resolveServiceMock.mockReturnValue({ ...provider(), platformId: 'custom:newapi' })
    const fetchMock = vi.fn(async () => modelsResponse('provider-model'))
    vi.stubGlobal('fetch', fetchMock)
    const service = new CodexExperimentService()

    const [model] = await service.listModels('/project')
    expect(model).toMatchObject({
      id: 'provider-model',
      defaultReasoningEffort: 'high',
    })
    expect(model?.supportedReasoningEfforts?.map((option) => option.value))
      .toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])

    const [cachedModel] = await service.listModels('/project')
    expect(cachedModel).toEqual(model)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes after expiry and does not cache failures as an app-server fallback', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    const fetchMock = vi.fn(async () => modelsResponse(`provider-model-${fetchMock.mock.calls.length}`))
    vi.stubGlobal('fetch', fetchMock)
    const service = new CodexExperimentService()

    expect((await service.listModels('/project')).map((model) => model.id)).toEqual(['provider-model-1'])
    now.mockReturnValue(181_001)
    expect((await service.listModels('/project')).map((model) => model.id)).toEqual(['provider-model-2'])

    providerOverrideMock.mockReturnValue({})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const failingService = new CodexExperimentService()
    await expect(failingService.listModels('/project')).rejects.toThrow('HTTP 401')
    expect(appServerMock).not.toHaveBeenCalled()
    now.mockRestore()
  })

  it('keeps caches separate for credentials that share a provider URL', async () => {
    resolveServiceMock.mockImplementation((_harness: string, credentialId: string | null) => ({
      ...provider(credentialId === 'credential-b' ? 'key-b' : 'key-a'),
      credentialId: credentialId ?? 'credential-a',
    }))
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization
      return modelsResponse(authorization === 'Bearer key-b' ? 'model-b' : 'model-a')
    })
    vi.stubGlobal('fetch', fetchMock)
    const service = new CodexExperimentService()

    expect((await service.listModels('/project', 'credential-a')).map((model) => model.id)).toEqual(['model-a'])
    expect((await service.listModels('/project', 'credential-b')).map((model) => model.id)).toEqual(['model-b'])
    expect((await service.listModels('/project', 'credential-a')).map((model) => model.id)).toEqual(['model-a'])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
