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
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
}))

const {
  resolveThread,
  streamTurnEvents,
  respondToCodexPermission,
  respondToCodexElicitation,
  runCodexTurn,
  mapThreadItemFromAppServer,
  mapApprovalRequest,
  extractSuperoneMiniAppToolName,
} = await import('./codex-turn')
const { createCodexSession } = await import('./codex-session')

function makeSession(overrides: { threadId?: string | null; model?: string } = {}) {
  return {
    ...createCodexSession('test-session', '/project', overrides.model, overrides.threadId ?? undefined, undefined, 'default'),
  }
}

describe('resolveThread fallback', () => {
  const permissionProfile = {
    permissionPreset: 'default' as const,
    approvalPolicy: 'unless-allow-listed' as const,
    sandboxMode: 'permissive' as const,
    networkAccessEnabled: true,
  }

  it('falls back to thread/start when thread/resume fails', async () => {
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

describe('extractSuperoneMiniAppToolName', () => {
  it('extracts mini-app tool name from codex elicitation message', () => {
    expect(
      extractSuperoneMiniAppToolName('Allow the superone MCP server to run tool "excalidraw__clear_canvas"?'),
    ).toBe('mcp__superone__excalidraw__clear_canvas')
  })

  it('returns null when message lacks namespaced tool format', () => {
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
      persistExtendedHistory: false,
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
      persistExtendedHistory: false,
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
          nickname: 'worker-2',
          role: 'explorer',
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
          developer_instructions: null,
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
      persistExtendedHistory: true,
    }))
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread-4',
      approvalPolicy: 'never',
      sandboxPolicy: {
        type: 'dangerFullAccess',
      },
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
