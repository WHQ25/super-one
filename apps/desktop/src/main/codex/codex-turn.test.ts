import { beforeEach, describe, expect, it, vi } from 'vitest'

// The harness install-root module (reached via the codex binary resolver) pulls
// in electron, which has no ESM named exports under vitest.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-test' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

vi.mock('../providers/resolver', () => ({ resolveChatService: vi.fn(() => null) }))

vi.mock('../providers/llm-proxy-manager', () => ({
  ensureCodexProxyUrl: vi.fn(async () => undefined),
  getCodexProxyUrl: vi.fn(() => undefined),
  ensureProxy: vi.fn(async () => ({ url: '', port: 0 })),
  shutdownAll: vi.fn(),
}))

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

vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
  isBuiltInSuperoneTool: vi.fn(() => false),
}))

const appServerConnection = await import('./app-server-connection')
const {
  resolveThread,
  withSessionConnection,
  withThreadConnection,
  closeSessionConnection,
  streamTurnEvents,
  respondToCodexPermission,
  respondToCodexElicitation,
  runCodexTurn,
  interruptCodex,
  mapThreadItemFromAppServer,
  buildReasoningItem,
  mapApprovalRequest,
  extractSuperoneMiniAppToolName,
  waitForCodexMcpServerReady,
} = await import('./codex-turn')
const { getActiveProviderRaw, getProviderByIdRaw } = await import('../database')
const { resolveChatService } = await import('../providers/resolver')

function codexService(over: Record<string, unknown> = {}) {
  return {
    platformId: 'gw', brand: 'My Gateway', planId: 'api', endpointId: 'openai', credentialId: 'c1',
    task: 'chat', protocol: 'openai-chat', baseUrl: '', apiKey: 'sk-test', auth: 'api-key', models: [],
    ...over,
  } as never
}
const { createCodexSession } = await import('./codex-session')
const { CODEX_SYSTEM_PROMPT_APPEND } = await import('../agent/superone-system-prompt')

function makeSession(overrides: { threadId?: string | null; model?: string } = {}) {
  return {
    ...createCodexSession('test-session', '/project', overrides.model, overrides.threadId ?? undefined, undefined, 'default'),
  }
}

describe('waitForCodexMcpServerReady', () => {
  type Note = { requestIdRaw?: unknown; method: string; params: Record<string, unknown> }
  function makeConn(queue: Array<Note | null>) {
    let i = 0
    return {
      request: vi.fn(async () => ({})),
      respond: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      nextNotification: vi.fn(),
      pollNotification: vi.fn(async () => (i < queue.length ? queue[i++] : null)),
    } as never
  }
  const startup = (name: string, status: string) => ({ method: 'mcpServer/startupStatus/updated', params: { name, status } })

  it('returns once the target server reaches a ready (non-starting) status', async () => {
    const conn = makeConn([
      startup('linear', 'starting'),
      startup('superone', 'starting'),
      startup('superone', 'ready'),
      startup('codex_apps', 'starting'), // would come later; must not be needed
    ])
    await waitForCodexMcpServerReady(conn, makeSession() as never, 'superone', 1_000)
    // Polled exactly up to the superone 'ready' notification (3 polls), not the 4th.
    expect((conn as { pollNotification: { mock: { calls: unknown[] } } }).pollNotification.mock.calls.length).toBe(3)
  })

  it('returns when the target server fails to start (settled), without hanging', async () => {
    const conn = makeConn([startup('superone', 'starting'), startup('superone', 'failed')])
    await waitForCodexMcpServerReady(conn, makeSession() as never, 'superone', 1_000)
    expect((conn as { pollNotification: { mock: { calls: unknown[] } } }).pollNotification.mock.calls.length).toBe(2)
  })

  it('gives up at the deadline if the server never reports (turn still proceeds)', async () => {
    const conn = makeConn([]) // only nulls → no startup notification ever
    const start = Date.now()
    await waitForCodexMcpServerReady(conn, makeSession() as never, 'superone', 80)
    expect(Date.now() - start).toBeGreaterThanOrEqual(75)
  })

  it('is a no-op when the connection cannot poll notifications', async () => {
    const conn = { request: vi.fn(), respond: vi.fn(), notify: vi.fn(), nextNotification: vi.fn() } as never
    await expect(waitForCodexMcpServerReady(conn, makeSession() as never, 'superone', 1_000)).resolves.toBeUndefined()
  })
})

describe('resolveThread fallback', () => {
  const permissionProfile = {
    permissionPreset: 'default' as const,
    approvalPolicy: 'unless-allow-listed' as const,
    sandboxMode: 'permissive' as const,
    networkAccessEnabled: true,
  }

  it('shares one app-server connection across concurrent cold-resume callers', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'existing-thread' })
    const connection = {
      request: vi.fn(async () => ({})),
      respond: vi.fn(async () => {}),
      notify: vi.fn(async () => {}),
      nextNotification: vi.fn(() => new Promise<never>(() => {})),
    }
    const handle = {
      id: 'conn-shared',
      connection,
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    const createConnection = vi.spyOn(appServerConnection, 'createAppServerConnection')
      .mockResolvedValue(handle)

    try {
      const [first, second] = await Promise.all([
        withSessionConnection(session, { mode: 'auto' }, undefined, async (conn) => conn),
        withSessionConnection(session, { mode: 'auto' }, undefined, async (conn) => conn),
      ])

      expect(createConnection).toHaveBeenCalledTimes(1)
      expect(first).toBe(connection)
      expect(second).toBe(connection)
      expect(session.connectionHandle).toBe(handle)
    } finally {
      createConnection.mockRestore()
      await closeSessionConnection(session)
    }
  })

  it('detaches a closed handle synchronously before a reconnect', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'existing-thread' })
    const dispatcher = { close: vi.fn() }
    const handle = {
      connection: {},
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: () => () => {},
    }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }
    session.notificationDispatcher = dispatcher as never
    session.threadReady = true

    await closeSessionConnection(session)

    expect(handle.close).toHaveBeenCalledOnce()
    expect(dispatcher.close).toHaveBeenCalledWith('connection closed')
    expect(session.connectionHandle).toBeNull()
    expect(session.connectionAuth).toBeNull()
    expect(session.threadId).toBeNull()
    expect(session.threadReady).toBe(false)
    expect(session.notificationDispatcher).toBeNull()
  })

  it('discards a dead connection even after a mutation may have started', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'existing-thread' })
    const handle = {
      connection: {},
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: () => () => {},
    }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }
    session.notificationDispatcher = { close: vi.fn() } as never
    const writeError = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })

    await expect(withSessionConnection(
      session,
      { mode: 'auto' },
      undefined,
      async () => { throw writeError },
    )).rejects.toBe(writeError)

    expect(handle.close).toHaveBeenCalledOnce()
    expect(session.connectionHandle).toBeNull()
  })

  it('falls back to thread/start when the stored thread does not exist', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'stale-thread' })
    const mockConnection = {
      request: vi.fn()
        .mockRejectedValueOnce(new Error('thread not found'))
        .mockResolvedValueOnce({ thread: { id: 'new-thread-1' } }),
    } as never

    const result = await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    expect(result).toBe('new-thread-1')
    expect(session.threadId).toBe('new-thread-1')
    expect(session.threadReady).toBe(true)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(2)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][0]).toBe('thread/resume')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[1][0]).toBe('thread/start')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        developer_instructions: CODEX_SYSTEM_PROMPT_APPEND,
      }),
    }))
  })

  it('preserves the stored thread when resume fails because the connection closed', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'existing-thread' })
    const mockConnection = {
      request: vi.fn().mockRejectedValue(new Error('Codex app-server closed unexpectedly')),
    } as never

    await expect(
      resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never),
    ).rejects.toThrow(/closed unexpectedly/)

    expect(session.threadId).toBe('existing-thread')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(1)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).not.toHaveBeenCalledWith(
      'thread/start',
      expect.anything(),
    )
  })

  it('retries thread/resume once on a fresh app-server connection', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'existing-thread' })
    const auth = { mode: 'auto' as const }
    const secondConnection = {
      request: vi.fn().mockResolvedValue({ thread: { id: 'existing-thread' } }),
    }
    const secondHandle = {
      connection: secondConnection,
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: () => () => {},
    }
    const firstHandle = {
      connection: {
        request: vi.fn().mockRejectedValue(new Error('Codex app-server closed unexpectedly')),
      },
      close: vi.fn(async () => {
        session.connectionHandle = secondHandle as never
        session.connectionAuth = auth
        session.notificationDispatcher = {} as never
      }),
      getStderr: () => '',
      onClosed: () => () => {},
    }
    session.connectionHandle = firstHandle as never
    session.connectionAuth = auth
    session.notificationDispatcher = {} as never

    const result = await withThreadConnection(
      session,
      auth,
      undefined,
      '/project',
      '/project',
      permissionProfile as never,
      async ({ threadId }) => threadId,
    )

    expect(result).toBe('existing-thread')
    expect(firstHandle.close).toHaveBeenCalledTimes(1)
    expect(secondConnection.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({
      threadId: 'existing-thread',
    }))
  })

  it('uses thread/resume when it succeeds', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'valid-thread' })
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'valid-thread' } }),
    } as never

    const result = await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    expect(result).toBe('valid-thread')
    expect(session.threadReady).toBe(true)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(1)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][0]).toBe('thread/resume')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        developer_instructions: CODEX_SYSTEM_PROMPT_APPEND,
      }),
    }))
  })

  it('uses thread/start when no threadId exists', async () => {
    const session = makeSession({ model: 'gpt-5' })
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    } as never

    const result = await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    expect(result).toBe('fresh-thread')
    expect(session.threadReady).toBe(true)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(1)
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][0]).toBe('thread/start')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        developer_instructions: CODEX_SYSTEM_PROMPT_APPEND,
      }),
    }))
  })

  it('passes the shared HTTP MCP config into thread/start', async () => {
    const { setSuperoneMcpBridgeRuntime } = await import('../mcp/superone-mcp-stdio-state')
    const { deriveSuperoneMcpSessionToken } = await import('../mcp/superone-mcp-auth')
    setSuperoneMcpBridgeRuntime({
      endpoint: '/tmp/superone.sock',
      httpUrl: 'http://127.0.0.1:3210/mcp',
      token: 'token-1',
      bridgeScriptPath: '/app/superone-mcp-stdio-bridge.js',
    })
    try {
      const session = makeSession({ model: 'gpt-5' })
      const mockConnection = {
        request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
      } as never

      await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

      const payload = (mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]
      expect(payload.config.mcp_servers.superone).toEqual({
        url: 'http://127.0.0.1:3210/mcp',
        http_headers: {
          Authorization: `Bearer ${deriveSuperoneMcpSessionToken('token-1', session.superoneSessionId)}`,
          'X-SuperOne-Session-Id': session.superoneSessionId,
        },
        startup_timeout_sec: 60,
      })
    } finally {
      setSuperoneMcpBridgeRuntime(null)
    }
  })

  it('reuses a ready thread on the current app-server connection', async () => {
    const session = makeSession({ model: 'gpt-5', threadId: 'ready-thread' })
    session.threadReady = true
    const mockConnection = {
      request: vi.fn(),
    } as never

    const result = await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    expect(result).toBe('ready-thread')
    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).not.toHaveBeenCalled()
  })
})

describe('resolveThread custom Codex provider', () => {
  const permissionProfile = {
    permissionPreset: 'default' as const,
    approvalPolicy: 'unless-allow-listed' as const,
    sandboxMode: 'permissive' as const,
    networkAccessEnabled: true,
  }

  beforeEach(() => {
    vi.mocked(resolveChatService).mockReturnValue(null)
  })

  it('injects model_providers config and selects it via top-level model_provider when an active codex provider has a base_url', async () => {
    vi.mocked(resolveChatService).mockReturnValue(codexService({ baseUrl: 'https://gw.example.com/v1' }))
    const session = makeSession({ model: 'gpt-5' })
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    } as never

    await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    const [method, payload] = (mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0]
    expect(method).toBe('thread/start')
    expect(payload.model_provider).toBe('superone_custom')
    expect(payload.config.model_providers.superone_custom).toEqual(
      expect.objectContaining({
        base_url: 'https://gw.example.com/v1',
        env_key: 'CODEX_API_KEY',
        wire_api: 'responses',
        requires_openai_auth: false,
      }),
    )
  })

  it('does not set model_provider or model_providers when no active codex provider', async () => {
    const session = makeSession({ model: 'gpt-5' })
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    } as never

    await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    const payload = (mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]
    expect(payload.model_provider).toBeUndefined()
    expect(payload.config?.model_providers).toBeUndefined()
  })

  it('does not set a provider override when the active codex provider has no base_url', async () => {
    vi.mocked(resolveChatService).mockReturnValue(codexService({ baseUrl: '' }))
    const session = makeSession({ model: 'gpt-5' })
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    } as never

    await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    const payload = (mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]
    expect(payload.model_provider).toBeUndefined()
    expect(payload.config?.model_providers).toBeUndefined()
  })

  it('resolves the override from the session apiProviderId (per-session /provider) over the DB-active provider', async () => {
    vi.mocked(resolveChatService).mockImplementation((_h, id) =>
      id === 'sess-gw' ? codexService({ baseUrl: 'https://session/v1' }) : codexService({ baseUrl: 'https://global/v1' }),
    )
    const session = {
      ...createCodexSession('test-session', '/project', 'gpt-5', undefined, undefined, 'default', 'sess-gw'),
    }
    const mockConnection = {
      request: vi.fn().mockResolvedValueOnce({ thread: { id: 'fresh-thread' } }),
    } as never

    await resolveThread(mockConnection, session, '/project', '/project', permissionProfile as never)

    const payload = (mockConnection as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0][1]
    expect(payload.model_provider).toBe('superone_custom')
    expect(payload.config.model_providers.superone_custom.base_url).toBe('https://session/v1')
  })
})

describe('respondToCodexPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves cancel decisions distinctly from declines', () => {
    const resolve = vi.fn()
    const session = makeSession()
    session.pendingApprovals.set('req-1', {
      responseKind: 'decision',
      resolve,
      reject: vi.fn(),
    })

    expect(respondToCodexPermission(session, 'req-1', false, undefined, undefined, 'cancel')).toBe(true)
    expect(resolve).toHaveBeenCalledWith({ decision: 'cancel' })
    expect(session.pendingApprovals.has('req-1')).toBe(false)
  })

  it('routes elicitation pending entries through respondToCodexElicitation', () => {
    const resolve = vi.fn()
    const session = makeSession()
    session.pendingApprovals.set('req-2', {
      responseKind: 'elicitation',
      resolve,
      reject: vi.fn(),
    })

    expect(respondToCodexPermission(session, 'req-2', true, true)).toBe(true)
    expect(resolve).toHaveBeenCalledWith({
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    })
  })
})

describe('mapApprovalRequest mcpServer/elicitation/request', () => {
  it('parses approval-only elicitation (empty schema) into a PermissionRequest', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 0,
      requestId: '0',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 't1',
        turnId: 'turn1',
        serverName: 'computer-use',
        mode: 'form',
        message: 'Allow Codex to use Google Chrome?',
        requestedSchema: { type: 'object', properties: {} },
        _meta: {
          persist: ['always'],
          riskLevel: 'high',
          subtitle: 'Risky',
        },
      },
    })

    expect(parsed?.responseKind).toBe('elicitation')
    if (parsed?.responseKind !== 'elicitation') return
    expect(parsed.formFields).toEqual([])
    expect(parsed.request).toMatchObject({
      requestId: '0',
      toolName: 'computer-use',
      requestKind: 'mcp_elicitation',
      serverName: 'computer-use',
      message: 'Allow Codex to use Google Chrome?',
      subtitle: 'Risky',
      riskLevel: 'high',
      supportsAlwaysPersist: true,
      allowAlwaysAllow: true,
    })
    expect(parsed.request.elicitationForm).toBeUndefined()
  })

  it('parses form-mode elicitation across string / boolean / number / enum types', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 7,
      requestId: '7',
      method: 'mcpServer/elicitation/request',
      params: {
        message: 'Configure',
        serverName: 'demo',
        requestedSchema: {
          type: 'object',
          required: ['name', 'mood'],
          properties: {
            name: { type: 'string', title: 'Name', description: 'Your name' },
            age: { type: 'integer' },
            optIn: { type: 'boolean', title: 'Opt-in' },
            mood: { type: 'string', enum: ['happy', 'sad'], title: 'Mood' },
          },
        },
      },
    })

    expect(parsed?.responseKind).toBe('elicitation')
    if (parsed?.responseKind !== 'elicitation') return
    expect(parsed.formFields).toEqual([
      { name: 'name', type: 'string', label: 'Name', description: 'Your name', required: true },
      { name: 'age', type: 'number', label: 'age', required: false },
      { name: 'optIn', type: 'boolean', label: 'Opt-in', required: false },
      { name: 'mood', type: 'enum', label: 'Mood', required: true, enumOptions: ['happy', 'sad'] },
    ])
    expect(parsed.request.elicitationForm).toEqual(parsed.formFields)
  })
})

describe('buildReasoningItem timing', () => {
  it('stamps startedAt and endedAt on a fresh reasoning item', () => {
    const item = buildReasoningItem('r1', 'thinking', undefined)
    expect(item.startedAt).toBeTypeOf('number')
    expect(item.endedAt).toBeTypeOf('number')
    expect(item.endedAt).toBeGreaterThanOrEqual(item.startedAt!)
  })

  it('keeps the original startedAt and advances endedAt across updates', () => {
    const prev = { id: 'r1', type: 'reasoning' as const, text: 'a', startedAt: 1000, endedAt: 2000 }
    const next = buildReasoningItem('r1', 'a b', prev)
    expect(next.startedAt).toBe(1000)
    expect(next.endedAt).toBeGreaterThan(2000)
  })
})

describe('extractSuperoneMiniAppToolName', () => {
  it('extracts mini-app tool name from codex elicitation message', () => {
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "excalidraw__clear_canvas"?'),
    ).toBe('mcp__superone__excalidraw__clear_canvas')
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "miniapp_call"?'),
    ).toBe('mcp__superone__miniapp_call')
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "miniapp_list"?'),
    ).toBe('mcp__superone__miniapp_list')
  })

  it('extracts built-in superone tool name even without namespace separator', () => {
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "read_manual"?'),
    ).toBe('mcp__superone__read_manual')
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "session_rename"?'),
    ).toBe('mcp__superone__session_rename')
  })

  it('extracts SuperOne computer-use tools (feature-gated, not in static builtin list)', () => {
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "computer_apps"?'),
    ).toBe('mcp__superone__computer_apps')
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "computer_snapshot"?'),
    ).toBe('mcp__superone__computer_snapshot')
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "computer_act"?'),
    ).toBe('mcp__superone__computer_act')
    // Deprecated alias still rewrites so isBuiltInSuperoneTool / normalize can match.
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "computer_observe"?'),
    ).toBe('mcp__superone__computer_observe')
  })

  it('extracts mobile_share_file (session-gated host tool, not in static builtin list)', () => {
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "mobile_share_file"?'),
    ).toBe('mcp__superone__mobile_share_file')
  })

  it('returns null when tool is neither a built-in nor a namespaced mini-app tool', () => {
    // open-computer-use external tools (not SuperOne host tools)
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "list_apps"?'),
    ).toBeNull()
  })

  it('returns null when message has no recognizable tool reference', () => {
    expect(extractSuperoneMiniAppToolName('Allow access?')).toBeNull()
  })
})

describe('mapApprovalRequest superone mini-app tool elicitation', () => {
  it('rewrites superone elicitation into a plain tool-call PermissionRequest (no mcp_elicitation kind)', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 11,
      requestId: '11',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'superone',
        message: 'Allow the superone MCP server to run tool "excalidraw__clear_canvas"?',
        requestedSchema: { type: 'object', properties: {} },
        _meta: { persist: ['always'] },
      },
    })

    expect(parsed?.responseKind).toBe('elicitation')
    if (parsed?.responseKind !== 'elicitation') return
    expect(parsed.formFields).toEqual([])
    expect(parsed.request.toolName).toBe('mcp__superone__excalidraw__clear_canvas')
    expect(parsed.request.allowAlwaysAllow).toBe(false)
    expect(parsed.request.supportsAlwaysPersist).toBe(false)
    expect(parsed.request.requestKind).toBeUndefined()
    expect(parsed.request.message).toBeUndefined()
  })

  it('rewrites built-in superone tool elicitation so pre-approve check can match by qualified name', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 21,
      requestId: '21',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'superone',
        message: 'Allow the superone MCP server to run tool "read_manual"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    })

    if (parsed?.responseKind !== 'elicitation') throw new Error('expected elicitation')
    expect(parsed.request.toolName).toBe('mcp__superone__read_manual')
    expect(parsed.request.requestKind).toBeUndefined()
  })

  it('rewrites computer-use tool elicitation so built-in auto-approve can match', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 22,
      requestId: '22',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'superone',
        message: 'Allow the superone MCP server to run tool "computer_apps"?',
        requestedSchema: { type: 'object', properties: {} },
        _meta: { persist: ['always'] },
      },
    })

    if (parsed?.responseKind !== 'elicitation') throw new Error('expected elicitation')
    // Must be qualified — if this stays "superone", processServerRequest never auto-accepts.
    expect(parsed.request.toolName).toBe('mcp__superone__computer_apps')
    expect(parsed.request.requestKind).toBeUndefined()
    expect(parsed.request.message).toBeUndefined()
  })

  it('keeps original elicitation shape for non-superone servers', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 12,
      requestId: '12',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'computer-use',
        message: 'Allow Codex to use Google Chrome?',
        requestedSchema: { type: 'object', properties: {} },
        _meta: { persist: ['always'] },
      },
    })

    if (parsed?.responseKind !== 'elicitation') throw new Error('expected elicitation')
    expect(parsed.request.requestKind).toBe('mcp_elicitation')
    expect(parsed.request.toolName).toBe('computer-use')
  })

  it('keeps elicitation shape for superone elicit with a form (not a plain approval)', () => {
    const parsed = mapApprovalRequest({
      requestIdRaw: 13,
      requestId: '13',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'superone',
        message: 'Allow the superone MCP server to run tool "demo__edit"?',
        requestedSchema: {
          type: 'object',
          required: ['note'],
          properties: { note: { type: 'string' } },
        },
      },
    })

    if (parsed?.responseKind !== 'elicitation') throw new Error('expected elicitation')
    expect(parsed.request.requestKind).toBe('mcp_elicitation')
    expect(parsed.formFields.length).toBeGreaterThan(0)
  })
})

describe('respondToCodexElicitation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  function setupPending() {
    const resolve = vi.fn()
    const session = makeSession()
    session.pendingApprovals.set('e1', {
      responseKind: 'elicitation',
      resolve,
      reject: vi.fn(),
    })
    return { session, resolve }
  }

  it('serializes accept without form into action=accept,content=null,_meta=null', () => {
    const { session, resolve } = setupPending()
    expect(respondToCodexElicitation(session, 'e1', true)).toBe(true)
    expect(resolve).toHaveBeenCalledWith({ action: 'accept', content: null, _meta: null })
  })

  it('serializes accept + alwaysAllow into _meta.persist=always', () => {
    const { session, resolve } = setupPending()
    respondToCodexElicitation(session, 'e1', true, true)
    expect(resolve).toHaveBeenCalledWith({ action: 'accept', content: null, _meta: { persist: 'always' } })
  })

  it('serializes accept + form answers as content', () => {
    const { session, resolve } = setupPending()
    respondToCodexElicitation(session, 'e1', true, false, undefined, { name: 'Alice', age: 30 })
    expect(resolve).toHaveBeenCalledWith({
      action: 'accept',
      content: { name: 'Alice', age: 30 },
      _meta: null,
    })
  })

  it('serializes decline correctly', () => {
    const { session, resolve } = setupPending()
    respondToCodexElicitation(session, 'e1', false)
    expect(resolve).toHaveBeenCalledWith({ action: 'decline', content: null, _meta: null })
  })

  it('serializes cancel correctly', () => {
    const { session, resolve } = setupPending()
    respondToCodexElicitation(session, 'e1', false, undefined, 'cancel')
    expect(resolve).toHaveBeenCalledWith({ action: 'cancel', content: null, _meta: null })
  })

  it('returns false when pending entry is not an elicitation', () => {
    const session = makeSession()
    session.pendingApprovals.set('d1', {
      responseKind: 'decision',
      resolve: vi.fn(),
      reject: vi.fn(),
    })
    expect(respondToCodexElicitation(session, 'd1', true)).toBe(false)
  })
})

describe('streamTurnEvents mcp startup failure reason', () => {
  it('surfaces reauthenticationRequired on onMcpServerStatus when a server fails to start', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: 'mcpServer/startupStatus/updated', params: { name: 'linear', status: 'starting' } },
      {
        method: 'mcpServer/startupStatus/updated',
        params: { name: 'linear', status: 'failed', failureReason: 'reauthenticationRequired' },
      },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onMcpServerStatus = vi.fn()

    await streamTurnEvents(mockConnection, session, null, new AbortController(), { onMcpServerStatus })

    expect(onMcpServerStatus).toHaveBeenLastCalledWith([
      { name: 'linear', status: 'failed', failureReason: 'reauthenticationRequired' },
    ])
  })
})

describe('streamTurnEvents token accounting', () => {
  it('sums every model response in a turn and ignores duplicate snapshots', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const firstUsage = {
      last: { inputTokens: 100, cachedInputTokens: 30, cacheWriteInputTokens: 5, outputTokens: 20 },
      total: { inputTokens: 100, cachedInputTokens: 30, cacheWriteInputTokens: 5, outputTokens: 20 },
      modelContextWindow: 128_000,
    }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: 'thread/tokenUsage/updated', params: { threadId: 'main-thread', tokenUsage: firstUsage } },
      { method: 'thread/tokenUsage/updated', params: { threadId: 'main-thread', tokenUsage: firstUsage } },
      {
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'main-thread',
          tokenUsage: {
            last: { inputTokens: 80, cachedInputTokens: 50, cacheWriteInputTokens: 7, outputTokens: 10 },
            total: { inputTokens: 180, cachedInputTokens: 80, cacheWriteInputTokens: 12, outputTokens: 30 },
            modelContextWindow: 128_000,
          },
        },
      },
      { method: 'turn/completed', params: { threadId: 'main-thread', turn: { status: 'completed' } } },
    ]
    const connection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(connection, session, null, new AbortController())

    expect(result.turnUsage).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 12,
    })
  })
})

describe('streamTurnEvents compaction lifecycle', () => {
  it('keeps contextCompaction out of Codex items and completes the shared compact UI lifecycle', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: {
            last: { inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 10 },
            total: { inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 10 },
            modelContextWindow: 128_000,
          },
        },
      },
      {
        method: 'item/started',
        params: {
          threadId: 'main-thread',
          turnId: 'compact-turn',
          startedAtMs: 1_000,
          item: { id: 'compact-item', type: 'contextCompaction' },
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'main-thread',
          turnId: 'compact-turn',
          completedAtMs: 2_500,
          item: { id: 'compact-item', type: 'contextCompaction' },
        },
      },
      { method: 'thread/compacted', params: { threadId: 'main-thread', turnId: 'compact-turn' } },
      { method: 'turn/completed', params: { threadId: 'main-thread', turn: { id: 'compact-turn', status: 'completed' } } },
    ]
    const connection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onItemDelta = vi.fn()
    const onCompactionStarted = vi.fn()
    const onCompactionCompleted = vi.fn()

    const result = await streamTurnEvents(
      connection,
      session,
      null,
      new AbortController(),
      { onItemDelta, onCompactionStarted, onCompactionCompleted },
      { compactionTrigger: 'manual' },
    )

    expect(onCompactionStarted).toHaveBeenCalledOnce()
    expect(onCompactionStarted).toHaveBeenCalledWith('manual')
    expect(onCompactionCompleted).toHaveBeenCalledOnce()
    expect(onCompactionCompleted).toHaveBeenCalledWith({
      trigger: 'manual',
      preTokens: 12_000,
      postTokens: 12_000,
      durationMs: 1_500,
    })
    expect(onItemDelta).not.toHaveBeenCalled()
    expect(result.items).toEqual([])
  })
})

describe('streamTurnEvents child-thread routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes snake_case child thread events into collab childItems instead of top-level items', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-1',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            receiver_thread_ids: ['child-1'],
            agents_states: {
              'child-1': {
                status: 'running',
                nickname: 'worker',
              },
            },
          },
        },
      },
      {
        method: 'item/started',
        params: {
          thread_id: 'child-1',
          item: {
            id: 'child-msg-1',
            type: 'agent_message',
            text: 'child hello',
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          turn: {
            status: 'completed',
          },
        },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onItemDelta = vi.fn()

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith('thread/resume', {
      threadId: 'child-1',
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'collab-1',
      type: 'collab_tool_call',
      childItems: {
        'child-1': [
          {
            id: 'child-msg-1',
            type: 'agent_message',
            text: 'child hello',
          },
        ],
      },
    })
    expect(onItemDelta.mock.calls.some(([, item]) => item?.type === 'agent_message')).toBe(false)
  })

  it('normalizes modern collabToolCall payloads into the legacy internal shape', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications = [
      {
        method: 'item/completed',
        params: {
          threadId: 'main-thread',
          item: {
            id: 'collab-2',
            type: 'collabToolCall',
            tool: 'spawn_agent',
            status: 'completed',
            receiverThreadId: 'child-2',
            agentStatus: {
              status: 'pending_init',
              nickname: 'worker-2',
              role: 'explorer',
            },
          },
        },
      },
      {
        method: 'item/started',
        params: {
          threadId: 'child-2',
          item: {
            id: 'child-msg-2',
            type: 'agent_message',
            text: 'child hi',
          },
        },
      },
      {
        method: 'turn/completed',
        params: {
          turn: {
            status: 'completed',
          },
        },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect((mockConnection as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith('thread/resume', {
      threadId: 'child-2',
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'collab-2',
      type: 'collab_tool_call',
      tool: 'spawnAgent',
      receiverThreadIds: ['child-2'],
      agentsStates: {
        'child-2': {
          status: 'pendingInit',
        },
      },
      childItems: {
        'child-2': [
          {
            id: 'child-msg-2',
            type: 'agent_message',
            text: 'child hi',
          },
        ],
      },
    })
  })

  it('marks sub-agent running on child turn/started and completed on child turn/completed', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-7',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            receiver_thread_ids: ['child-7'],
            agents_states: { 'child-7': { status: 'pendingInit', message: null } },
          },
        },
      },
      {
        method: 'turn/started',
        params: { threadId: 'child-7', turn: { id: 'turn-1' } },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'child-7', turn: { id: 'turn-1', status: 'completed' } },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockImplementation(async (method: string) => {
        if (method === 'thread/resume') throw new Error('no rollout found')
        if (method === 'thread/read') return { thread: { id: 'child-7', agentNickname: 'Bob' } }
        return {}
      }),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const updates: Array<{ status: string | undefined }> = []
    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      {
        onItemDelta: (_phase, item) => {
          if (item.type === 'collab_tool_call' && item.id === 'collab-7') {
            updates.push({ status: item.agentsStates['child-7']?.status })
          }
        },
      },
    )

    expect(result.items[0]).toMatchObject({
      id: 'collab-7',
      type: 'collab_tool_call',
      agentsStates: { 'child-7': { status: 'completed', nickname: 'Bob' } },
    })
    expect(updates.some((u) => u.status === 'running')).toBe(true)
    expect(updates[updates.length - 1]?.status).toBe('completed')
  })

  it('reads sub-agent nickname/role via thread/read on subscribe and merges into agentsStates', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-3',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            receiver_thread_ids: ['child-3'],
            agents_states: {
              'child-3': { status: 'pendingInit', message: null },
            },
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const requestCalls: Array<{ method: string; params: unknown }> = []
    const mockConnection = {
      request: vi.fn().mockImplementation(async (method: string, params: unknown) => {
        requestCalls.push({ method, params })
        if (method === 'thread/resume') throw new Error('no rollout found')
        if (method === 'thread/read') {
          return {
            thread: {
              id: 'child-3',
              agentNickname: 'Epicurus',
              agentRole: 'researcher',
            },
          }
        }
        return {}
      }),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect(requestCalls).toContainEqual({
      method: 'thread/read',
      params: { threadId: 'child-3', includeTurns: false },
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'collab-3',
      type: 'collab_tool_call',
      agentsStates: {
        'child-3': {
          nickname: 'Epicurus',
          role: 'researcher',
        },
      },
    })
  })

  it('marks orphan collab spawn as failed when turn completes without item/completed', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/started',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-orphan',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'inProgress',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: [],
            agents_states: {},
            prompt: 'do something',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'collab-orphan',
      type: 'collab_tool_call',
      tool: 'spawnAgent',
      status: 'failed',
      receiverThreadIds: [],
      agentsStates: {},
    })
  })

  it('passes through item/completed status="failed" from the protocol', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-fail',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'failed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: [],
            agents_states: {},
            prompt: 'bad args',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect(result.items[0]).toMatchObject({
      id: 'collab-fail',
      type: 'collab_tool_call',
      status: 'failed',
    })
  })

  it('does not mark a resumed worker sub-agent as forked from its spawn source parent', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-send-1',
            type: 'collabAgentToolCall',
            tool: 'sendInput',
            status: 'failed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['child-resume'],
            agents_states: {
              'child-resume': { status: 'notFound', message: null },
            },
            prompt: 'continue working',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-resume-1',
            type: 'collabAgentToolCall',
            tool: 'resumeAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['child-resume'],
            agents_states: {
              'child-resume': { status: 'pendingInit', message: null },
            },
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-send-2',
            type: 'collabAgentToolCall',
            tool: 'sendInput',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['child-resume'],
            agents_states: {
              'child-resume': { status: 'pendingInit', message: null },
            },
            prompt: 'continue working',
          },
        },
      },
      {
        method: 'turn/started',
        params: { threadId: 'child-resume', turn: { id: 'child-turn-1' } },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'child-resume',
          item: {
            id: 'child-cmd-1',
            type: 'command_execution',
            command: 'git status --short -- hello_world.py',
            status: 'completed',
          },
        },
      },
      {
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'child-resume',
          tokenUsage: {
            last: {
              inputTokens: 30_000,
              cachedInputTokens: 1_000,
              outputTokens: 362,
              reasoningOutputTokens: 0,
            },
            total: {
              inputTokens: 171_300,
              cachedInputTokens: 0,
              outputTokens: 3_900,
              reasoningOutputTokens: 0,
            },
          },
        },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'child-resume', turn: { id: 'child-turn-1', status: 'completed' } },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const requestCalls: Array<{ method: string; params: unknown }> = []
    const mockConnection = {
      request: vi.fn().mockImplementation(async (method: string, params: unknown) => {
        requestCalls.push({ method, params })
        if (method === 'thread/resume') return {}
        if (method === 'thread/read') {
          return {
            thread: {
              id: 'child-resume',
              agentNickname: 'Euler',
              agentRole: 'worker',
              forkedFromId: null,
              source: {
                subAgent: {
                  thread_spawn: {
                    parent_thread_id: 'main-thread',
                    depth: 1,
                    agent_nickname: 'Euler',
                    agent_role: 'worker',
                  },
                },
              },
            },
          }
        }
        return {}
      }),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect(requestCalls).toContainEqual({
      method: 'thread/read',
      params: { threadId: 'child-resume', includeTurns: false },
    })
    const failedSendInput = result.items.find(
      (it) => it.type === 'collab_tool_call' && it.id === 'collab-send-1',
    )
    if (failedSendInput?.type !== 'collab_tool_call') throw new Error('expected failed collab_tool_call')
    expect(failedSendInput.childItems?.['child-resume']).toBeUndefined()
    expect(failedSendInput.agentsStates['child-resume']?.tokens).toBeUndefined()

    const lastSendInput = result.items.find(
      (it) => it.type === 'collab_tool_call' && it.id === 'collab-send-2',
    )
    if (lastSendInput?.type !== 'collab_tool_call') throw new Error('expected collab_tool_call')
    expect(lastSendInput).toMatchObject({
      type: 'collab_tool_call',
      tool: 'sendInput',
      receiverThreadIds: ['child-resume'],
      agentsStates: {
        'child-resume': {
          role: 'worker',
        },
      },
      childItems: {
        'child-resume': [
          {
            id: 'child-cmd-1',
            type: 'command_execution',
            command: 'git status --short -- hello_world.py',
            status: 'completed',
          },
        ],
      },
    })
    expect(lastSendInput.agentsStates['child-resume']?.forkedFromId).toBeUndefined()
    expect(lastSendInput.agentsStates['child-resume']?.tokens).toEqual({ input: 29_000, output: 362 })
    expect(result.turnUsage).toEqual({
      inputTokens: 29_000,
      outputTokens: 362,
      cacheReadInputTokens: 1_000,
      cacheCreationInputTokens: 0,
    })
  })
})

describe('streamTurnEvents superone preapprove short-circuit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto-accepts preapproved superone mini-app tools without forwarding to UI', async () => {
    const { isToolPreapproved } = await import('../mcp/superone-mcp-server')
    vi.mocked(isToolPreapproved).mockImplementation(
      (name: string) => name === 'mcp__superone__excalidraw__clear_canvas',
    )

    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<Record<string, unknown>> = [
      {
        requestIdRaw: 99,
        requestId: '99',
        method: 'mcpServer/elicitation/request',
        params: {
          serverName: 'superone',
          message: 'Allow the superone MCP server to run tool "excalidraw__clear_canvas"?',
          requestedSchema: { type: 'object', properties: {} },
          _meta: { persist: ['always'] },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const respond = vi.fn().mockResolvedValue(undefined)
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond,
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onPermissionRequest = vi.fn()

    await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onPermissionRequest },
    )

    expect(onPermissionRequest).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(99, { action: 'accept', content: null, _meta: null })
  })

  it('auto-accepts miniapp_call elicitation (host-owned static admit); executor owns app-tool gate', async () => {
    // miniapp_call is host-owned: Codex elicitation auto-accepts without args.
    // Non-preapproved (appId, tool) is prompted later via host permission_request
    // inside executeMiniappCall — not via this elicitation.
    const { isBuiltInSuperoneTool } = await import('../mcp/superone-mcp-server')
    vi.mocked(isBuiltInSuperoneTool).mockImplementation(
      (name: string) => name === 'mcp__superone__miniapp_call' || name === 'mcp__superone__miniapp_list',
    )

    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<Record<string, unknown>> = [
      {
        requestIdRaw: 100,
        requestId: '100',
        method: 'mcpServer/elicitation/request',
        params: {
          serverName: 'superone',
          message: 'Allow the superone MCP server to run tool "miniapp_call"?',
          requestedSchema: { type: 'object', properties: {} },
          _meta: { persist: ['always'] },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const respond = vi.fn().mockResolvedValue(undefined)
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond,
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onPermissionRequest = vi.fn()

    await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onPermissionRequest },
    )

    expect(onPermissionRequest).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(100, { action: 'accept', content: null, _meta: null })
  })

  it('auto-accepts SuperOne computer-use tools without forwarding to UI', async () => {
    const { isBuiltInSuperoneTool } = await import('../mcp/superone-mcp-server')
    vi.mocked(isBuiltInSuperoneTool).mockImplementation(
      (name: string) => name === 'mcp__superone__computer_apps',
    )

    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<Record<string, unknown>> = [
      {
        requestIdRaw: 100,
        requestId: '100',
        method: 'mcpServer/elicitation/request',
        params: {
          serverName: 'superone',
          message: 'Allow the superone MCP server to run tool "computer_apps"?',
          requestedSchema: { type: 'object', properties: {} },
          _meta: { persist: ['always'] },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const respond = vi.fn().mockResolvedValue(undefined)
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond,
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
    const onPermissionRequest = vi.fn()

    await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onPermissionRequest },
    )

    expect(onPermissionRequest).not.toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(100, { action: 'accept', content: null, _meta: null })
  })

  it('falls through to UI for non-preapproved superone tools', async () => {
    const { isToolPreapproved } = await import('../mcp/superone-mcp-server')
    vi.mocked(isToolPreapproved).mockReturnValue(false)

    const session = { ...makeSession(), threadId: 'main-thread' }
    const notifications: Array<Record<string, unknown>> = [
      {
        requestIdRaw: 42,
        requestId: '42',
        method: 'mcpServer/elicitation/request',
        params: {
          serverName: 'superone',
          message: 'Allow the superone MCP server to run tool "excalidraw__clear_canvas"?',
          requestedSchema: { type: 'object', properties: {} },
          _meta: { persist: ['always'] },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ]
    const respond = vi.fn().mockResolvedValue(undefined)
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond,
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = notifications.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never

    const onPermissionRequest = vi.fn((req) => {
      const pending = session.pendingApprovals.get(req.requestId)
      pending?.resolve({ action: 'decline', content: null, _meta: null })
    })

    await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onPermissionRequest },
    )

    expect(onPermissionRequest).toHaveBeenCalledTimes(1)
    const reqArg = onPermissionRequest.mock.calls[0][0]
    expect(reqArg.toolName).toBe('mcp__superone__excalidraw__clear_canvas')
    expect(reqArg.requestKind).toBeUndefined()
    expect(respond).toHaveBeenCalledWith(42, { action: 'decline', content: null, _meta: null })
  })
})

describe('runCodexTurn turn/start payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeConnectionDriver(threadId: string, turnId: string) {
    const notifications = [
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'thread/start' || method === 'thread/resume') {
        return { thread: { id: threadId } }
      }
      if (method === 'turn/start') {
        return { turn: { id: turnId } }
      }
      return {}
    })
    const handle = {
      connection: {
        request,
        respond: vi.fn(async () => {}),
        notify: vi.fn(async () => {}),
        nextNotification: vi.fn().mockImplementation(async () => {
          const next = notifications.shift()
          if (!next) throw new Error('no notification')
          return next
        }),
      },
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: (_cb: unknown) => () => {},
    }
    return { handle, request }
  }

  it('requests concise reasoning summary when reasoning effort is set', async () => {
    const { handle, request } = makeConnectionDriver('thread-1', 'turn-1')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.modelReasoningEffort = 'high'
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      permissionPreset: 'default',
    })

    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-1',
      model: 'gpt-5.4',
      effort: 'high',
      summary: 'concise',
    }))
  })

  it('does not request reasoning summary when reasoning effort is absent', async () => {
    const { handle, request } = makeConnectionDriver('thread-2', 'turn-2')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })

    expect(request).toHaveBeenCalledWith('turn/start', expect.any(Object))
    const turnStartCall = request.mock.calls.find((c) => c[0] === 'turn/start')
    expect(turnStartCall?.[1]).not.toHaveProperty('summary')
  })

  it('adds project and session directories to workspace-write roots', async () => {
    const { handle, request } = makeConnectionDriver('thread-roots', 'turn-roots')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      permissionPreset: 'default',
      additionalDirectories: ['/shared', '/project'],
    })

    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      sandboxPolicy: expect.objectContaining({
        type: 'workspaceWrite',
        writableRoots: ['/project', '/shared'],
      }),
    }))
  })

  it('sends explicit default collaboration mode when plan mode is not selected', async () => {
    const { handle, request } = makeConnectionDriver('thread-3', 'turn-3')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'default',
      collaborationMode: 'default',
    })

    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-3',
      collaborationMode: {
        mode: 'default',
        settings: {
          model: 'gpt-5.4',
          reasoning_effort: null,
          developer_instructions: CODEX_SYSTEM_PROMPT_APPEND,
        },
      },
    }))
  })

  it('sends resolved full-access permission profile to thread and turn app-server APIs', async () => {
    const { handle, request } = makeConnectionDriver('thread-4', 'turn-4')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.permissionPreset = 'full-access'
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'full-access',
    })

    expect(request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    }))
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-4',
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'dangerFullAccess',
      },
    }))
  })

  it('sends Fast service tier and Approve for me reviewer to app-server', async () => {
    const { handle, request } = makeConnectionDriver('thread-fast', 'turn-fast')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.permissionPreset = 'auto-review'
    session.serviceTier = 'priority'
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    await runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'Test prompt',
      model: 'gpt-5.4',
      permissionPreset: 'auto-review',
      serviceTier: 'priority',
    })

    expect(request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
      serviceTier: 'priority',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    }))
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-fast',
      serviceTier: 'priority',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    }))
  })
})

describe('mapThreadItemFromAppServer image generation', () => {
  it('maps a completed imageGeneration item with camelCase fields', () => {
    const result = mapThreadItemFromAppServer({
      id: 'ig-1',
      type: 'imageGeneration',
      status: 'completed',
      revisedPrompt: 'a fluffy orange cat with a hat',
      savedPath: '/tmp/codex/generated_images/sess-1/ig-1.png',
    })

    expect(result).toEqual({
      id: 'ig-1',
      type: 'image_generation',
      status: 'completed',
      revisedPrompt: 'a fluffy orange cat with a hat',
      savedPath: '/tmp/codex/generated_images/sess-1/ig-1.png',
    })
  })

  it('accepts snake_case field names from the protocol', () => {
    const result = mapThreadItemFromAppServer({
      id: 'ig-2',
      type: 'image_generation',
      status: 'completed',
      revised_prompt: 'a sunset over mountains',
      saved_path: '/tmp/codex/generated_images/sess-1/ig-2.png',
    })

    expect(result).toMatchObject({
      id: 'ig-2',
      type: 'image_generation',
      revisedPrompt: 'a sunset over mountains',
      savedPath: '/tmp/codex/generated_images/sess-1/ig-2.png',
    })
  })

  it('defaults missing status to in_progress on the first event', () => {
    const result = mapThreadItemFromAppServer({
      id: 'ig-3',
      type: 'imageGeneration',
    })

    expect(result).toEqual({
      id: 'ig-3',
      type: 'image_generation',
      status: 'in_progress',
    })
  })

  it('merges saved_path from a completed event into a previously in-progress item', () => {
    const previous = {
      id: 'ig-4',
      type: 'image_generation' as const,
      status: 'in_progress',
    }
    const result = mapThreadItemFromAppServer(
      {
        id: 'ig-4',
        type: 'imageGeneration',
        status: 'completed',
        savedPath: '/tmp/foo.png',
      },
      previous,
    )

    expect(result).toEqual({
      id: 'ig-4',
      type: 'image_generation',
      status: 'completed',
      savedPath: '/tmp/foo.png',
    })
  })

  it('preserves prior savedPath when a follow-up event omits it', () => {
    const previous = {
      id: 'ig-5',
      type: 'image_generation' as const,
      status: 'completed',
      revisedPrompt: 'a city skyline',
      savedPath: '/tmp/bar.png',
    }
    const result = mapThreadItemFromAppServer(
      {
        id: 'ig-5',
        type: 'imageGeneration',
        status: 'completed',
      },
      previous,
    )

    expect(result).toMatchObject({
      savedPath: '/tmp/bar.png',
      revisedPrompt: 'a city skyline',
    })
  })
})

describe('mapThreadItemFromAppServer web search', () => {
  it('maps an in-progress web_search item with snake_case type', () => {
    const result = mapThreadItemFromAppServer({
      id: 'ws-1',
      type: 'web_search',
      status: 'in_progress',
      query: 'electron 41 esm spawn',
    })

    expect(result).toEqual({
      id: 'ws-1',
      type: 'web_search',
      query: 'electron 41 esm spawn',
      status: 'in_progress',
    })
  })

  it('upgrades a previously in_progress web_search to completed on follow-up event', () => {
    const previous = {
      id: 'ws-2',
      type: 'web_search' as const,
      query: 'codex protocol thread items',
      status: 'in_progress' as const,
    }
    const result = mapThreadItemFromAppServer(
      {
        id: 'ws-2',
        type: 'webSearch',
        status: 'completed',
      },
      previous,
    )

    expect(result).toEqual({
      id: 'ws-2',
      type: 'web_search',
      query: 'codex protocol thread items',
      status: 'completed',
    })
  })

  it('defaults missing status to completed on a one-shot event', () => {
    const result = mapThreadItemFromAppServer({
      id: 'ws-3',
      type: 'web_search',
      query: 'react server components',
    })

    expect(result).toEqual({
      id: 'ws-3',
      type: 'web_search',
      query: 'react server components',
      status: 'completed',
    })
  })
})

describe('streamTurnEvents finalizes stale in_progress items on turn/completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeStreamingConnection(notifications: Array<{ method: string; params: Record<string, unknown> }>) {
    const remaining = [...notifications]
    return {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = remaining.shift()
        if (!next) throw new Error('no notification')
        return next
      }),
    } as never
  }

  it('consumes the inbox bound to the turn connection', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const wrongInbox = {
      next: vi.fn(async () => { throw new Error('read from replacement dispatcher') }),
      poll: vi.fn(async () => null),
    }
    session.notificationDispatcher = { mainInbox: wrongInbox } as never
    const mockConnection = makeStreamingConnection([])
    const boundInbox = {
      next: vi.fn(async () => ({
        method: 'turn/completed',
        params: { threadId: 'main-thread', turn: { id: 'bound-turn', status: 'completed' } },
      })),
      poll: vi.fn(async () => null),
    }

    const result = await streamTurnEvents(
      mockConnection,
      session,
      'bound-turn',
      new AbortController(),
      undefined,
      { notificationInbox: boundInbox, connectionId: 'conn-bound' },
    )

    expect(result.turnId).toBe('bound-turn')
    expect(boundInbox.next).toHaveBeenCalledOnce()
    expect(wrongInbox.next).not.toHaveBeenCalled()
    expect(mockConnection.nextNotification).not.toHaveBeenCalled()
  })

  it('captures an automatic turn id and installs turn controls from turn/started', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const mockConnection = makeStreamingConnection([
      {
        method: 'turn/started',
        params: { threadId: 'main-thread', turn: { id: 'automatic-turn' } },
      },
      {
        method: 'turn/completed',
        params: { threadId: 'main-thread', turn: { id: 'automatic-turn', status: 'completed' } },
      },
    ])

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
    )

    expect(result.turnId).toBe('automatic-turn')
    expect(session.activeTurnId).toBe('automatic-turn')

    await session.steerFn?.('Continue')
    await session.interruptFn?.()

    expect(mockConnection.request).toHaveBeenNthCalledWith(1, 'turn/steer', {
      threadId: 'main-thread',
      input: [{ type: 'text', text: 'Continue' }],
      expectedTurnId: 'automatic-turn',
    })
    expect(mockConnection.request).toHaveBeenNthCalledWith(2, 'turn/interrupt', {
      threadId: 'main-thread',
      turnId: 'automatic-turn',
    })
  })

  it('finalizes mcp_tool_call stuck in_progress when item/completed never arrives', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const mockConnection = makeStreamingConnection([
      {
        method: 'item/started',
        params: {
          threadId: 'main-thread',
          item: {
            id: 'mcp-stuck',
            type: 'mcp_tool_call',
            server: 'fs',
            tool: 'read',
            arguments: { path: '/tmp/x' },
            status: 'in_progress',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ])
    const onItemDelta = vi.fn()

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'mcp-stuck',
      type: 'mcp_tool_call',
      status: 'completed',
    })
    expect(
      onItemDelta.mock.calls.some(([phase, item]) =>
        phase === 'completed' && item?.id === 'mcp-stuck' && item?.status === 'completed',
      ),
    ).toBe(true)
  })

  it('finalizes command_execution stuck in_progress when item/completed never arrives', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const mockConnection = makeStreamingConnection([
      {
        method: 'item/started',
        params: {
          threadId: 'main-thread',
          item: {
            id: 'cmd-stuck',
            type: 'command_execution',
            command: 'ls',
            status: 'in_progress',
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ])
    const onItemDelta = vi.fn()

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: 'cmd-stuck',
      type: 'command_execution',
      status: 'completed',
    })
  })

  it('finalizes todo_list with trailing incomplete items when final plan update never arrives', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const mockConnection = makeStreamingConnection([
      {
        method: 'turn/plan/updated',
        params: {
          plan: [
            { step: 'Investigate', status: 'completed' },
            { step: 'Fix', status: 'in_progress' },
            { step: 'Verify', status: 'pending' },
          ],
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ])
    const onItemDelta = vi.fn()

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    const todo = result.items.find((item) => item.type === 'todo_list')
    expect(todo).toBeDefined()
    expect(todo?.type === 'todo_list' && todo.items.every((i) => i.completed)).toBe(true)
    expect(
      onItemDelta.mock.calls.some(([phase, item]) =>
        phase === 'completed' &&
        item?.type === 'todo_list' &&
        item.items.every((i: { completed: boolean }) => i.completed),
      ),
    ).toBe(true)
  })

  it('preserves already-completed status (does not downgrade)', async () => {
    const session = { ...makeSession(), threadId: 'main-thread' }
    const mockConnection = makeStreamingConnection([
      {
        method: 'item/completed',
        params: {
          threadId: 'main-thread',
          item: {
            id: 'mcp-ok',
            type: 'mcp_tool_call',
            server: 'fs',
            tool: 'read',
            arguments: {},
            status: 'completed',
          },
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'main-thread',
          item: {
            id: 'mcp-fail',
            type: 'mcp_tool_call',
            server: 'fs',
            tool: 'read',
            arguments: {},
            status: 'failed',
            error: { message: 'boom' },
          },
        },
      },
      {
        method: 'turn/completed',
        params: { turn: { status: 'completed' } },
      },
    ])

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta: vi.fn() },
    )

    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ id: 'mcp-ok', status: 'completed' })
    expect(result.items[1]).toMatchObject({ id: 'mcp-fail', status: 'failed' })
  })
})

describe('streamTurnEvents image generation duration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps generationMs as the wall-clock gap from the previous item to the image landing', async () => {
    let now = 1_000_000
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Codex emits nothing during generation, then synthesizes started+completed
    // back-to-back AFTER the image is done. The real duration is the silent gap
    // between the prior item completing and the image item arriving.
    const GENERATION_GAP_MS = 149_000
    const notifications = [
      { method: 'item/started', params: { threadId: 'main-thread', item: { id: 'msg-1', type: 'agentMessage', text: '' } } },
      { method: 'item/completed', params: { threadId: 'main-thread', item: { id: 'msg-1', type: 'agentMessage', text: 'I will generate one image.' } } },
      { method: 'item/started', params: { threadId: 'main-thread', item: { id: 'ig-1', type: 'imageGeneration', status: 'in_progress' }, __advanceMs: GENERATION_GAP_MS } },
      { method: 'item/completed', params: { threadId: 'main-thread', item: { id: 'ig-1', type: 'imageGeneration', status: 'generating', savedPath: '/tmp/codex/ig-1.png' } } },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]
    const remaining = [...notifications]
    const mockConnection = {
      request: vi.fn().mockResolvedValue({}),
      respond: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn().mockResolvedValue(undefined),
      nextNotification: vi.fn().mockImplementation(async () => {
        const next = remaining.shift()
        if (!next) throw new Error('no notification')
        const advance = (next.params as Record<string, unknown>).__advanceMs
        if (typeof advance === 'number') now += advance
        return next
      }),
    } as never

    const session = { ...makeSession(), threadId: 'main-thread' }
    const onItemDelta = vi.fn()

    const result = await streamTurnEvents(
      mockConnection,
      session,
      null,
      new AbortController(),
      { onItemDelta },
    )

    const image = result.items.find((item) => item.type === 'image_generation')
    expect(image).toMatchObject({ id: 'ig-1', type: 'image_generation', generationMs: GENERATION_GAP_MS })

    const completedEmit = onItemDelta.mock.calls.find(
      ([phase, item]) => phase === 'completed' && item?.id === 'ig-1',
    )
    expect(completedEmit?.[1]).toMatchObject({ generationMs: GENERATION_GAP_MS })

    // The synthetic started emit precedes generation knowledge — no duration yet.
    const startedEmit = onItemDelta.mock.calls.find(
      ([phase, item]) => phase === 'started' && item?.id === 'ig-1',
    )
    expect(startedEmit?.[1]?.generationMs).toBeUndefined()

    dateSpy.mockRestore()
  })
})

describe('interruptCodex during a running turn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeInterruptibleConnection(threadId: string, turnId: string) {
    const queue: Array<{ method: string; params: Record<string, unknown> }> = []
    let pendingResolve: ((n: { method: string; params: Record<string, unknown> }) => void) | null = null

    const push = (n: { method: string; params: Record<string, unknown> }) => {
      if (pendingResolve) {
        const resolve = pendingResolve
        pendingResolve = null
        resolve(n)
      } else {
        queue.push(n)
      }
    }

    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: threadId } }
      if (method === 'turn/start') return { turn: { id: turnId } }
      if (method === 'turn/interrupt') {
        // Real codex app-server aborts the active turn and emits
        // turn/completed{interrupted}; the deferred response resolves on TurnAborted.
        push({ method: 'turn/completed', params: { turn: { id: turnId, status: 'interrupted' } } })
        return {}
      }
      return {}
    })

    const handle = {
      connection: {
        request,
        respond: vi.fn(async () => {}),
        notify: vi.fn(async () => {}),
        nextNotification: vi.fn(async () => {
          const queued = queue.shift()
          if (queued) return queued
          // Long-running turn: never completes on its own until interrupted.
          return new Promise<{ method: string; params: Record<string, unknown> }>((resolve) => {
            pendingResolve = resolve
          })
        }),
      },
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: (_cb: unknown) => () => {},
    }
    return { handle, request }
  }

  it('sends turn/interrupt for the active turn and rejects the run as interrupted without killing the pooled connection', async () => {
    const { handle, request } = makeInterruptibleConnection('thread-int', 'turn-int')
    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    const runPromise = runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'a long running task',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })

    await vi.waitFor(() => {
      expect(session.activeTurnId).toBe('turn-int')
    })

    const handled = interruptCodex(session)
    expect(handled).toBe(true)

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('turn/interrupt', {
        threadId: 'thread-int',
        turnId: 'turn-int',
      })
    })

    await expect(runPromise).rejects.toThrow(/interrupt/i)
    expect(handle.close).not.toHaveBeenCalled()
  })

  // Regression: the local abort fallback only ran when turn/interrupt REJECTED.
  // An app-server that accepts the request and then goes quiet left the run
  // streaming forever with Stop already spent.
  it('falls back to the local abort when turn/interrupt never answers', async () => {
    const { handle } = makeInterruptibleConnection('thread-quiet', 'turn-quiet')
    const connection = handle.connection as unknown as {
      request: (method: string, params?: unknown) => Promise<unknown>
    }
    const answering = connection.request
    connection.request = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'turn/interrupt') return new Promise(() => {})
      return answering(method, params)
    }) as never

    const session = { ...makeSession({ model: 'gpt-5.4' }) }
    session.connectionHandle = handle as never
    session.connectionAuth = { mode: 'auto' }

    const runPromise = runCodexTurn(session, { mode: 'auto' }, '/project', {
      prompt: 'a long running task',
      model: 'gpt-5.4',
      permissionPreset: 'default',
    })
    const settled = runPromise.then(() => 'resolved' as const, () => 'rejected' as const)

    await vi.waitFor(() => {
      expect(session.activeTurnId).toBe('turn-quiet')
    })

    vi.useFakeTimers()
    try {
      expect(interruptCodex(session)).toBe(true)
      await vi.advanceTimersByTimeAsync(30_000)
    } finally {
      vi.useRealTimers()
    }

    await expect(settled).resolves.toBe('rejected')
  })
})
