import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getProviderByIdRaw: vi.fn(() => undefined),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

const { createHandleMock, getProviderOverrideMock } = vi.hoisted(() => ({
  createHandleMock: vi.fn(),
  getProviderOverrideMock: vi.fn(() => null),
}))

vi.mock('./app-server-connection', async () => {
  const actual = await vi.importActual<typeof import('./app-server-connection')>('./app-server-connection')
  return {
    ...actual,
    createAppServerConnection: (...args: unknown[]) => createHandleMock(...args),
    getCodexProviderOverrideFor: (...args: unknown[]) => getProviderOverrideMock(...args),
  }
})

const { CodexExperimentService, parseAppServerModelForTest } = await import('./codex-experiment-service')
const { getActiveProviderRaw, getProviderByIdRaw } = await import('../database')
const { resolveChatService } = await import('../providers/resolver')

// Bridge the new resolver to the legacy DB mocks the setups below still use.
function resolveChatServiceFromDbMocks(_harness: string, id?: string | null) {
  const row = (id ? getProviderByIdRaw(id) : undefined) ?? getActiveProviderRaw('codex')
  if (!row) return null
  const codex = JSON.parse((row as { agent_configs?: string }).agent_configs || '{}').codex ?? {}
  return {
    platformId: 'gw',
    brand: (row as { name: string }).name,
    planId: 'api',
    endpointId: 'openai',
    credentialId: (row as { id: string }).id,
    task: 'chat',
    protocol: 'openai-chat',
    baseUrl: codex.base_url ?? '',
    apiKey: (row as { api_key?: string }).api_key ?? '',
    auth: 'api-key',
    models: [],
    extraEnv: codex.extra_env ? JSON.parse(codex.extra_env) : undefined,
  } as never
}

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
    getProviderOverrideMock.mockReturnValue(null)
    createHandleMock.mockReset()
    vi.mocked(getActiveProviderRaw).mockReturnValue(null as never)
    vi.mocked(getProviderByIdRaw).mockReturnValue(undefined as never)
    vi.mocked(resolveChatService).mockImplementation(resolveChatServiceFromDbMocks)
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

  it('reads the actual ChatGPT account on an official disposable connection', async () => {
    const handle = makeModelHandle()
    vi.mocked(handle.connection.request).mockResolvedValueOnce({
      account: { type: 'chatgpt', email: 'dev@example.com', planType: 'plus' },
      requiresOpenaiAuth: true,
    })
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()

    await expect(service.getAccountStatus()).resolves.toEqual({
      signedIn: true,
      authMode: 'chatgpt',
      email: 'dev@example.com',
      planType: 'plus',
      requiresOpenaiAuth: true,
    })
    expect(handle.connection.request).toHaveBeenCalledWith('account/read', { refreshToken: false })
    expect(createHandleMock.mock.calls[0]?.[3]).toEqual([])
    expect(handle.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the browser login connection alive until Codex reports completion', async () => {
    const handle = makeModelHandle()
    let completeLogin!: () => void
    const loginCompleted = new Promise<void>((resolve) => { completeLogin = resolve })
    vi.mocked(handle.connection.request).mockResolvedValueOnce({
      type: 'chatgpt',
      loginId: 'login-1',
      authUrl: 'https://auth.openai.com/login',
    })
    handle.connection.pollNotification = vi.fn(async () => {
      await loginCompleted
      return {
        method: 'account/login/completed',
        params: { loginId: 'login-1', success: true },
      }
    })
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    const listener = vi.fn()
    service.onAuthChanged('/project', listener)

    const result = await service.startAccountLogin('/project')

    expect(result).toMatchObject({ loginId: 'login-1', type: 'chatgpt' })
    expect(handle.close).not.toHaveBeenCalled()
    completeLogin()
    await vi.waitFor(() => expect(handle.close).toHaveBeenCalledTimes(1))
    expect(listener).toHaveBeenCalledTimes(1)
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

  it('preserves the model-advertised order of supportedReasoningEfforts', async () => {
    const handle = {
      connection: {
        request: vi.fn(async (method: string) => {
          if (method === 'model/list') {
            return {
              data: [{
                id: 'gpt-test',
                model: 'gpt-test',
                displayName: 'GPT Test',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'high', description: 'deepest' },
                  { reasoningEffort: 'minimal', description: 'fastest' },
                  { reasoningEffort: 'medium', description: 'balanced' },
                ],
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
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()

    const models = await service.listModels('/project')

    expect(models[0]?.supportedReasoningEfforts?.map((e) => e.value)).toEqual(['high', 'minimal', 'medium'])
  })

  it('exposes app-server service tiers for the model selector', async () => {
    const handle = makeModelHandle()
    vi.mocked(handle.connection.request).mockResolvedValueOnce({
      data: [{
        id: 'gpt-test',
        model: 'gpt-test',
        displayName: 'GPT Test',
        supportedReasoningEfforts: [],
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Lower latency' }],
        defaultServiceTier: null,
      }],
    })
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()

    const models = await service.listModels('/project')

    expect(models[0]?.serviceTiers).toEqual([{ id: 'priority', name: 'Fast', description: 'Lower latency' }])
    expect(models[0]?.defaultServiceTier).toBeNull()
  })

  it('falls back to legacy additionalSpeedTiers when serviceTiers are absent', () => {
    expect(parseAppServerModelForTest({
      id: 'gpt-test',
      model: 'gpt-test',
      supportedReasoningEfforts: [],
      additionalSpeedTiers: ['fast'],
    })?.serviceTiers).toEqual([{ id: 'fast', name: 'Fast', description: '' }])
  })

  it('caches models per active codex provider and refetches when the provider changes', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p1', 'https://a.example.com/v1') as never)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p2', 'https://b.example.com/v1') as never)
    await service.listModels('/project')
    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleA.close).toHaveBeenCalledTimes(1)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
  })

  it('caches per session apiProviderId even when providers share a base URL', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getProviderByIdRaw).mockImplementation(((id: string) =>
      id === 'sess-a'
        ? codexProviderRow('sess-a', 'https://shared/v1')
        : codexProviderRow('sess-b', 'https://shared/v1')) as never)
    const service = new CodexExperimentService()

    await service.listModels('/project', 'sess-a')
    await service.listModels('/project', 'sess-a')
    expect(createHandleMock).toHaveBeenCalledTimes(1)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
    await service.listModels('/project', 'sess-b')
    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
  })

  it('refetches default models when its bound credential changes on the same base URL', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('default-a', 'https://shared/v1') as never)
    const service = new CodexExperimentService()

    await service.listModels('/project')
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('default-b', 'https://shared/v1') as never)
    service.handleProviderChanged(false)
    await new Promise((resolve) => setImmediate(resolve))
    await service.listModels('/project')

    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
    expect(handleB.connection.request).toHaveBeenCalledTimes(1)
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

  it('preserves per-provider model caches when only the default provider changes', async () => {
    const handleA = makeModelHandle()
    const handleB = makeModelHandle()
    createHandleMock.mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB)
    vi.mocked(getProviderByIdRaw).mockImplementation(((id: string) =>
      id === 'provider-a'
        ? codexProviderRow('provider-a', 'https://a.example.com/v1')
        : codexProviderRow('provider-b', 'https://b.example.com/v1')) as never)
    const service = new CodexExperimentService()

    await service.listModels('/project', 'provider-a')
    await service.listModels('/project', 'provider-b')
    service.handleProviderChanged(false)
    await new Promise((resolve) => setImmediate(resolve))
    await service.listModels('/project', 'provider-a')

    expect(createHandleMock).toHaveBeenCalledTimes(2)
    expect(handleA.connection.request).toHaveBeenCalledTimes(1)
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

  it('getRateLimits returns null for apiKey mode without spinning up a connection', async () => {
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'apiKey', apiKey: 'sk-test' })

    const limits = await service.getRateLimits('/project')

    expect(limits).toBeNull()
    expect(createHandleMock).not.toHaveBeenCalled()
  })

  it('getRateLimits parses primary/secondary windows from account/rateLimits/read for a chatgpt account', async () => {
    const handle = {
      connection: {
        request: vi.fn(async (method: string) => {
          if (method === 'account/rateLimits/read') {
            return {
              rateLimits: {
                primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_700_000_000 },
                secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: 1_700_500_000 },
                planType: 'plus',
              },
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
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const limits = await service.getRateLimits('/project')

    expect(handle.connection.request).toHaveBeenCalledWith('account/rateLimits/read')
    expect(limits).toEqual({
      primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_700_000_000 },
      secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: 1_700_500_000 },
      planType: 'plus',
      resetCredits: null,
    })
  })

  it('getRateLimits surfaces rateLimitResetCredits.availableCount as resetCredits', async () => {
    const handle = {
      connection: {
        request: vi.fn(async (method: string) => {
          if (method === 'account/rateLimits/read') {
            return {
              rateLimits: {
                primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1_700_000_000 },
                secondary: null,
                planType: 'plus',
              },
              rateLimitResetCredits: { availableCount: 3 },
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
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const limits = await service.getRateLimits('/project')

    expect(limits?.resetCredits).toBe(3)
  })

  it('getRateLimits parses per-credit reset detail rows into resetCreditList', async () => {
    const handle = {
      connection: {
        request: vi.fn(async (method: string) => {
          if (method === 'account/rateLimits/read') {
            return {
              rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_700_000_000 }, secondary: null, planType: 'plus' },
              rateLimitResetCredits: {
                availableCount: 2,
                credits: [
                  { id: 'cr-1', status: 'available', resetType: 'codexRateLimits', grantedAt: 1_700_000_000, expiresAt: 1_700_100_000, title: 'Weekly boost', description: null },
                  { id: 'cr-2', status: 'redeemed', resetType: 'codexRateLimits', grantedAt: 1_699_000_000, expiresAt: null, title: null, description: null },
                ],
              },
            }
          }
          return {}
        }),
        respond: vi.fn(), notify: vi.fn(), nextNotification: vi.fn(),
      },
      close: vi.fn(async () => {}), getStderr: () => '', onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const limits = await service.getRateLimits('/project')

    expect(limits?.resetCredits).toBe(2)
    expect(limits?.resetCreditList).toEqual([
      { id: 'cr-1', status: 'available', title: 'Weekly boost', description: null, expiresAt: 1_700_100_000 },
      { id: 'cr-2', status: 'redeemed', title: null, description: null, expiresAt: null },
    ])
  })

  it('consumeRateLimitReset forwards creditId to the app-server when given', async () => {
    const request = vi.fn(async (method: string) => (method === 'account/rateLimitResetCredit/consume' ? { outcome: 'reset' } : {}))
    const handle = {
      connection: { request, respond: vi.fn(), notify: vi.fn(), nextNotification: vi.fn() },
      close: vi.fn(async () => {}), getStderr: () => '', onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    await service.consumeRateLimitReset('/project', null, 'cr-1')

    expect(request).toHaveBeenCalledWith('account/rateLimitResetCredit/consume', expect.objectContaining({ creditId: 'cr-1' }))
  })

  it('loginMcpServerOauth opens the authorization url then resolves on the completed notification', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'mcpServer/oauth/login' ? { authorizationUrl: 'https://auth.example.com/go' } : {})
    let polled = false
    const handle = {
      connection: {
        request,
        respond: vi.fn(),
        notify: vi.fn(),
        nextNotification: vi.fn(),
        pollNotification: vi.fn(async () => {
          if (polled) return null
          polled = true
          return { method: 'mcpServer/oauthLogin/completed', params: { name: 'linear', threadId: null, success: true } }
        }),
      },
      close: vi.fn(async () => {}), getStderr: () => '', onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })
    const openUrl = vi.fn()

    const result = await service.loginMcpServerOauth('/project', 'linear', null, openUrl)

    expect(request).toHaveBeenCalledWith('mcpServer/oauth/login', { name: 'linear' })
    expect(openUrl).toHaveBeenCalledWith('https://auth.example.com/go')
    expect(result).toEqual({ success: true, error: undefined })
  })

  it('detectExternalAgentConfig parses migration items from the app-server', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'externalAgentConfig/detect'
        ? { items: [
            { itemType: 'AGENTS_MD', description: 'AGENTS.md', cwd: '/project', details: { foo: 1 } },
            { itemType: 'MCP_SERVER_CONFIG', description: 'linear', cwd: null },
            { description: 'no type — dropped', cwd: null },
          ] }
        : {})
    const handle = {
      connection: { request, respond: vi.fn(), notify: vi.fn(), nextNotification: vi.fn() },
      close: vi.fn(async () => {}), getStderr: () => '', onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const items = await service.detectExternalAgentConfig('/project')

    expect(request).toHaveBeenCalledWith('externalAgentConfig/detect', { includeHome: true, cwds: ['/project'] })
    expect(items).toEqual([
      { itemType: 'AGENTS_MD', description: 'AGENTS.md', cwd: '/project', details: { foo: 1 } },
      { itemType: 'MCP_SERVER_CONFIG', description: 'linear', cwd: null },
    ])
  })

  it('importExternalAgentConfig re-sends items and summarizes the completed notification', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'externalAgentConfig/import' ? { importId: 'imp-1' } : {})
    let polled = false
    const handle = {
      connection: {
        request, respond: vi.fn(), notify: vi.fn(), nextNotification: vi.fn(),
        pollNotification: vi.fn(async () => {
          if (polled) return null
          polled = true
          return {
            method: 'externalAgentConfig/import/completed',
            params: { importId: 'imp-1', itemTypeResults: [
              { itemType: 'AGENTS_MD', successes: [{}, {}], failures: [] },
              { itemType: 'MCP_SERVER_CONFIG', successes: [], failures: [{}] },
            ] },
          }
        }),
      },
      close: vi.fn(async () => {}), getStderr: () => '', onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })
    const items = [{ itemType: 'AGENTS_MD', description: 'AGENTS.md', cwd: '/project' }]

    const result = await service.importExternalAgentConfig('/project', items)

    expect(request).toHaveBeenCalledWith('externalAgentConfig/import', { migrationItems: items, source: 'superone' })
    expect(result).toEqual({ successCount: 2, failureCount: 1 })
  })

  it('getRateLimits returns null when a custom codex provider is active (not a ChatGPT subscription)', async () => {
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p1', 'https://gateway.example.com/v1') as never)
    getProviderOverrideMock.mockReturnValue({})
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const limits = await service.getRateLimits('/project')

    expect(limits).toBeNull()
    expect(createHandleMock).not.toHaveBeenCalled()
  })

  it('getRateLimits returns null when the snapshot has no usage windows', async () => {
    const handle = {
      connection: {
        request: vi.fn(async () => ({ rateLimits: { primary: null, secondary: null, planType: 'plus' } })),
        respond: vi.fn(),
        notify: vi.fn(),
        nextNotification: vi.fn(),
      },
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    expect(await service.getRateLimits('/project')).toBeNull()
  })

  it('consumeRateLimitReset sends an idempotencyKey and parses the outcome for a chatgpt account', async () => {
    const requestMock = vi.fn(async (method: string) =>
      method === 'account/rateLimitResetCredit/consume' ? { outcome: 'reset' } : {},
    )
    const handle = {
      connection: {
        request: requestMock,
        respond: vi.fn(),
        notify: vi.fn(),
        nextNotification: vi.fn(),
      },
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const outcome = await service.consumeRateLimitReset('/project')

    expect(outcome).toBe('reset')
    const [method, params] = requestMock.mock.calls[0]
    expect(method).toBe('account/rateLimitResetCredit/consume')
    expect(typeof (params as { idempotencyKey: string }).idempotencyKey).toBe('string')
  })

  it('consumeRateLimitReset returns null without calling the server when not a chatgpt account', async () => {
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'apiKey', apiKey: 'sk-test' })

    expect(await service.consumeRateLimitReset('/project')).toBeNull()
    expect(createHandleMock).not.toHaveBeenCalled()
  })

  it('getAccountUsage parses the token-activity summary from account/usage/read for a chatgpt account', async () => {
    const handle = {
      connection: {
        request: vi.fn(async (method: string) => {
          if (method === 'account/usage/read') {
            return {
              summary: {
                lifetimeTokens: 1_250_000,
                peakDailyTokens: 84_000,
                longestRunningTurnSec: 612,
                currentStreakDays: 5,
                longestStreakDays: 12,
              },
              dailyUsageBuckets: [{ startDate: '2026-06-10', tokens: 40_000 }],
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
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const usage = await service.getAccountUsage('/project')

    expect(handle.connection.request).toHaveBeenCalledWith('account/usage/read')
    expect(usage).toEqual({
      lifetimeTokens: 1_250_000,
      peakDailyTokens: 84_000,
      longestRunningTurnSec: 612,
      currentStreakDays: 5,
      longestStreakDays: 12,
    })
  })

  it('getAccountUsage coerces stringified bigint token counts', async () => {
    const handle = {
      connection: {
        request: vi.fn(async () => ({ summary: { lifetimeTokens: '9007199254740993', peakDailyTokens: null, longestRunningTurnSec: null, currentStreakDays: null, longestStreakDays: null } })),
        respond: vi.fn(),
        notify: vi.fn(),
        nextNotification: vi.fn(),
      },
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    createHandleMock.mockResolvedValue(handle)
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    const usage = await service.getAccountUsage('/project')
    expect(usage?.lifetimeTokens).toBe(9007199254740993)
  })

  it('getAccountUsage returns null for apiKey accounts without opening a connection', async () => {
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'apiKey', apiKey: 'sk-test' })

    expect(await service.getAccountUsage('/project')).toBeNull()
    expect(createHandleMock).not.toHaveBeenCalled()
  })

  it('getAccountUsage returns null when a custom codex provider is active', async () => {
    vi.mocked(getActiveProviderRaw).mockReturnValue(codexProviderRow('p1', 'https://gateway.example.com/v1') as never)
    getProviderOverrideMock.mockReturnValue({})
    const service = new CodexExperimentService()
    service.setAuth('/project', { mode: 'chatgpt' })

    expect(await service.getAccountUsage('/project')).toBeNull()
    expect(createHandleMock).not.toHaveBeenCalled()
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
