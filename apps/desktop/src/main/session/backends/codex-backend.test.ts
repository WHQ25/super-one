import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexRunRequest,
  CodexRunResult,
  CodexThreadItem,
  CodexUsageInfo,
  PermissionRequest,
} from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

const turnMocks = vi.hoisted(() => {
  const state = {
    capturedCallbacks: undefined as unknown,
    resolveRun: (_r: unknown) => {},
    rejectRun: (_e: Error) => {},
  }
  const captureImpl = (
    _session: unknown,
    _auth: unknown,
    _projectPath: string,
    _request: unknown,
    callbacks?: unknown,
  ) => {
    state.capturedCallbacks = callbacks
    return new Promise((resolve, reject) => {
      state.resolveRun = resolve
      state.rejectRun = reject
    })
  }
  return {
    state,
    runCodexTurn: vi.fn(captureImpl),
    reviewCodexTurn: vi.fn(captureImpl),
    compactCodexTurn: vi.fn(captureImpl),
    steerCodex: vi.fn(async () => {}),
    deriveFinalResponse: (items: Array<{ type?: string; text?: string }>) => {
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]?.type === 'agent_message') return items[i].text ?? ''
      }
      return ''
    },
    interruptCodex: vi.fn(() => true),
    resetCodexSession: vi.fn(),
    respondToCodexPermission: vi.fn(() => true),
    respondToCodexQuestion: vi.fn(() => true),
    dismissCodexQuestion: vi.fn(() => true),
    prewarmCodexConnection: vi.fn(async () => null),
    prewarmCodexSession: vi.fn(async (_handle: unknown, session: { threadId: string | null; threadReady: boolean }) => {
      session.threadId = 'thread-prewarmed'
      session.threadReady = true
      return 'thread-prewarmed'
    }),
  }
})

vi.mock('../../codex/codex-turn', () => ({
  runCodexTurn: turnMocks.runCodexTurn,
  reviewCodexTurn: turnMocks.reviewCodexTurn,
  compactCodexTurn: turnMocks.compactCodexTurn,
  steerCodex: turnMocks.steerCodex,
  deriveFinalResponse: turnMocks.deriveFinalResponse,
  interruptCodex: turnMocks.interruptCodex,
  resetCodexSession: turnMocks.resetCodexSession,
  respondToCodexPermission: turnMocks.respondToCodexPermission,
  respondToCodexQuestion: turnMocks.respondToCodexQuestion,
  dismissCodexQuestion: turnMocks.dismissCodexQuestion,
  prewarmCodexConnection: turnMocks.prewarmCodexConnection,
  prewarmCodexSession: turnMocks.prewarmCodexSession,
}))

vi.mock('../../codex/codex-session', () => ({
  createCodexSession: (
    superoneSessionId: string,
    projectPath: string,
    model?: string,
    threadId?: string,
    modelReasoningEffort?: unknown,
    permissionPreset?: string,
  ) => ({
    superoneSessionId,
    projectPath,
    model,
    modelReasoningEffort,
    permissionPreset: permissionPreset ?? 'default',
    threadId: threadId ?? null,
    threadReady: false,
    effectiveCwd: null,
    runningController: null,
    pendingApprovals: new Map(),
    activeTurnId: null,
    steerFn: null,
    connectionHandle: null,
    connectionAuth: null,
    notificationDispatcher: null,
    forkListeners: new Map(),
    forkCallbacks: null,
  }),
  tearDownForkRuntime: (session: Record<string, unknown>) => {
    session.connectionHandle = null
    session.connectionAuth = null
    session.threadId = null
    session.threadReady = false
    session.effectiveCwd = null
    session.notificationDispatcher = null
  },
  codexSessionNeedsRebuild: (
    existing: { threadId: string | null; model?: string; modelReasoningEffort?: unknown; permissionPreset?: string },
    requestedModel?: string,
    requestedThreadId?: string,
    requestedReasoningEffort?: unknown,
    requestedPermissionPreset?: string,
  ) => {
    if (requestedThreadId && requestedThreadId !== existing.threadId) return true
    if (requestedModel && requestedModel !== existing.model) return true
    if (requestedReasoningEffort && requestedReasoningEffort !== existing.modelReasoningEffort) return true
    if (requestedPermissionPreset && requestedPermissionPreset !== existing.permissionPreset) return true
    return false
  },
}))

import { CodexBackend, type CodexRunStreamCallbacksDeps, type CodexServiceDeps } from './codex-backend'

function makeStartOpts(overrides: Partial<BackendStartOptions> = {}): BackendStartOptions {
  return {
    sessionId: 'sess-test',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config: { apiKey: 'codex-key', model: 'gpt-5.4' },
    permissionMode: 'default',
    abortController: new AbortController(),
    ...overrides,
  }
}

function makeResult(overrides: Partial<CodexRunResult> = {}): CodexRunResult {
  return {
    threadId: 'thread-xyz',
    finalResponse: 'ok',
    usage: null,
    items: [],
    ...overrides,
  }
}

function makeFakeService(): CodexServiceDeps & {
  capturedCallbacks: CodexRunStreamCallbacksDeps | undefined
  runMock: typeof turnMocks.runCodexTurn
  reviewMock: typeof turnMocks.reviewCodexTurn
  compactMock: typeof turnMocks.compactCodexTurn
  interruptMock: typeof turnMocks.interruptCodex
  resetMock: typeof turnMocks.resetCodexSession
  respondPermissionMock: typeof turnMocks.respondToCodexPermission
  respondQuestionMock: typeof turnMocks.respondToCodexQuestion
  dismissQuestionMock: typeof turnMocks.dismissCodexQuestion
  steerMock: typeof turnMocks.steerCodex
  resolveRun: (result: CodexRunResult) => void
  rejectRun: (err: Error) => void
} {
  turnMocks.runCodexTurn.mockClear()
  turnMocks.reviewCodexTurn.mockClear()
  turnMocks.compactCodexTurn.mockClear()
  turnMocks.steerCodex.mockClear()
  turnMocks.interruptCodex.mockClear()
  turnMocks.resetCodexSession.mockClear()
  turnMocks.respondToCodexPermission.mockClear()
  turnMocks.respondToCodexQuestion.mockClear()
  turnMocks.dismissCodexQuestion.mockClear()
  turnMocks.prewarmCodexConnection.mockClear()
  turnMocks.prewarmCodexSession.mockClear()

  const authChangedListeners = new Set<() => void>()
  return {
    getProjectAuth: (() => ({ mode: 'auto' as const })) as CodexServiceDeps['getProjectAuth'],
    onAuthChanged: ((_projectPath: string, cb: () => void) => {
      authChangedListeners.add(cb)
      return () => { authChangedListeners.delete(cb) }
    }) as CodexServiceDeps['onAuthChanged'],
    get capturedCallbacks() { return turnMocks.state.capturedCallbacks as CodexRunStreamCallbacksDeps | undefined },
    runMock: turnMocks.runCodexTurn,
    reviewMock: turnMocks.reviewCodexTurn,
    compactMock: turnMocks.compactCodexTurn,
    interruptMock: turnMocks.interruptCodex,
    resetMock: turnMocks.resetCodexSession,
    respondPermissionMock: turnMocks.respondToCodexPermission,
    respondQuestionMock: turnMocks.respondToCodexQuestion,
    dismissQuestionMock: turnMocks.dismissCodexQuestion,
    steerMock: turnMocks.steerCodex,
    resolveRun: (r) => turnMocks.state.resolveRun(r),
    rejectRun: (e) => turnMocks.state.rejectRun(e),
  }
}

describe('CodexBackend lifecycle', () => {
  let service: ReturnType<typeof makeFakeService>
  let backend: CodexBackend

  beforeEach(() => {
    service = makeFakeService()
    backend = new CodexBackend(service)
  })

  it('kind is codex', () => {
    expect(backend.kind).toBe('codex')
  })

  it('start() stores options and marks started', async () => {
    await backend.start(makeStartOpts())
    expect(backend.getStartOpts()).not.toBeNull()
  })

  it('start() throws if called twice without close', async () => {
    await backend.start(makeStartOpts())
    await expect(backend.start(makeStartOpts())).rejects.toThrow(/already started/)
  })

  it('close() disposes and blocks future starts', async () => {
    await backend.start(makeStartOpts())
    await backend.close()
    await expect(backend.start(makeStartOpts())).rejects.toThrow(/disposed/)
    expect(service.resetMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }))
  })

  it('send() throws when not started', async () => {
    await expect(backend.send({ content: 'x' })).rejects.toThrow(/not started/)
  })

  it('providerSessionId is preset from start opts', async () => {
    await backend.start({ ...makeStartOpts(), providerSessionId: 'thread-123' })
    expect(backend.getCurrentProviderSessionId()).toBe('thread-123')
  })

  it('adopts a prewarmed connection and keeps it when the first send sets Codex options', async () => {
    const close = vi.fn(async () => {})
    const handle = {
      connection: {},
      close,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    turnMocks.prewarmCodexConnection.mockResolvedValueOnce(handle as never)

    backend.prewarm(makeStartOpts())
    await backend.start(makeStartOpts())

    const pending = backend.send({
      content: 'x',
      model: 'gpt-5-max',
      codex: {
        reasoningEffort: 'high',
        permissionPreset: 'full-access',
      },
    })
    service.resolveRun(makeResult())
    await pending

    expect(service.resetMock).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    const [session] = service.runMock.mock.calls[0]! as [{ connectionHandle: unknown; model?: string; modelReasoningEffort?: string; permissionPreset?: string }]
    expect(session.connectionHandle).toBe(handle)
    expect(session.threadId).toBe('thread-prewarmed')
    expect(session.model).toBe('gpt-5-max')
    expect(session.modelReasoningEffort).toBe('high')
    expect(session.permissionPreset).toBe('full-access')
  })

  it('uses the shared project app-server pool for prewarm adoption when available', async () => {
    const close = vi.fn(async () => {})
    const handle = {
      connection: {},
      close,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    const pooledService = {
      ...service,
      prewarmAppServerConnection: vi.fn(),
      takeAppServerConnection: vi.fn(async () => handle as never),
    }
    backend = new CodexBackend(pooledService)

    backend.prewarm(makeStartOpts())
    await backend.start(makeStartOpts())

    expect(pooledService.prewarmAppServerConnection).toHaveBeenCalledWith('/tmp/proj')
    expect(pooledService.takeAppServerConnection).toHaveBeenCalledWith('/tmp/proj', { mode: 'auto' }, null)
    expect(turnMocks.prewarmCodexSession).toHaveBeenCalledWith(handle, expect.objectContaining({
      model: 'gpt-5.4',
      permissionPreset: 'default',
    }), '/tmp/proj')
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    expect(session.connectionHandle).toBe(handle)
    expect(session.threadId).toBe('thread-prewarmed')
    expect(close).not.toHaveBeenCalled()
  })

  it('extends the warm-handle idle window on keepalive re-prewarm (aligns with Claude expiry)', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn(async () => {})
      const handle = {
        connection: {},
        close,
        getStderr: () => '',
        onClosed: vi.fn(() => () => {}),
      }
      turnMocks.prewarmCodexConnection.mockResolvedValueOnce(handle as never)

      backend.prewarm(makeStartOpts())
      await vi.advanceTimersByTimeAsync(0)

      // Keepalive ping just before the original deadline resets the window.
      await vi.advanceTimersByTimeAsync(CodexBackend.WARM_IDLE_TIMEOUT_MS - 1000)
      backend.prewarm(makeStartOpts())

      // Past the ORIGINAL deadline but within the reset window → still warm.
      await vi.advanceTimersByTimeAsync(2000)
      expect(close).not.toHaveBeenCalled()

      // No further pings → expires WARM_IDLE_TIMEOUT_MS after the last ping.
      await vi.advanceTimersByTimeAsync(CodexBackend.WARM_IDLE_TIMEOUT_MS)
      expect(close).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns an idle app-server connection to the shared project pool on close', async () => {
    const close = vi.fn(async () => {})
    const handle = {
      connection: {},
      close,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    const releaseAppServerConnection = vi.fn()
    const pooledService = {
      ...service,
      releaseAppServerConnection,
    }
    backend = new CodexBackend(pooledService)
    await backend.start(makeStartOpts())
    const session = (backend as unknown as { session: { connectionHandle: unknown; connectionAuth: unknown } }).session
    session.connectionHandle = handle
    session.connectionAuth = { mode: 'auto' }

    await backend.close()

    expect(releaseAppServerConnection).toHaveBeenCalledWith('/tmp/proj', { mode: 'auto' }, handle, null)
    expect(close).not.toHaveBeenCalled()
  })

  it('rebuild() closes the stale codex connection so new auth takes effect next send', async () => {
    await backend.start(makeStartOpts())
    const session = (backend as unknown as { session: Record<string, unknown> }).session
    const close = vi.fn(async () => {})
    session.connectionHandle = { close } as never
    session.connectionAuth = { mode: 'auto' } as never
    session.threadId = 'stale-thread'

    await backend.rebuild(makeStartOpts())
    expect(close).toHaveBeenCalled()
    expect(session.connectionHandle).toBeNull()
    expect(session.connectionAuth).toBeNull()
    expect(session.threadId).toBeNull()
  })
})

describe('CodexBackend send()', () => {
  let service: ReturnType<typeof makeFakeService>
  let backend: CodexBackend
  let events: AgentEvent[]

  beforeEach(async () => {
    service = makeFakeService()
    backend = new CodexBackend(service)
    events = []
    backend.onEvent((e) => events.push(e))
    await backend.start(makeStartOpts())
  })

  it('forwards prompt / images / model / effort / permissionPreset / threadId / cwd to codex turn', async () => {
    const pending = backend.send({
      content: 'hello',
      model: 'gpt-5-max',
      effort: 'max',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'xxx' }],
    })
    service.resolveRun(makeResult({ finalResponse: 'hi' }))
    await pending

    expect(service.runMock).toHaveBeenCalledOnce()
    const [session, _auth, projectPath, request] = service.runMock.mock.calls[0]! as [
      { projectPath: string },
      unknown,
      string,
      CodexRunRequest,
    ]
    expect(session.projectPath).toBe('/tmp/proj')
    expect(projectPath).toBe('/tmp/proj')
    expect(request.prompt).toBe('hello')
    expect(request.model).toBe('gpt-5-max')
    expect(request.reasoningEffort).toBe('xhigh')
    expect(request.permissionPreset).toBe('default')
    expect(request.cwd).toBe('/tmp/proj')
    expect(request.messageId).toMatch(/^codex_/)
    expect(request.images).toHaveLength(1)
  })

  it('honors request.assistantMessageId when provided (renderer-provided id)', async () => {
    const pending = backend.send({ content: 'x', assistantMessageId: 'renderer_msg_99' })
    service.resolveRun(makeResult())
    await pending
    const [, , , req] = service.runMock.mock.calls[0]! as [unknown, unknown, string, CodexRunRequest]
    expect(req.messageId).toBe('renderer_msg_99')
    const start = events.find((e) => e.type === 'message_start') as { message: { id: string } }
    expect(start.message.id).toBe('renderer_msg_99')
  })

  it('request.codex.prompt overrides content for the Codex API request', async () => {
    const pending = backend.send({ content: 'user-visible text', codex: { prompt: 'codex-specific prompt' } })
    service.resolveRun(makeResult())
    await pending
    const [, , , req] = service.runMock.mock.calls[0]! as [unknown, unknown, string, CodexRunRequest]
    expect(req.prompt).toBe('codex-specific prompt')
  })

  it('passes codex-specific extras (collaborationMode / threadId / permissionPreset / reasoningEffort) to runCodexTurn', async () => {
    const pending = backend.send({
      content: 'x',
      codex: {
        collaborationMode: 'plan',
        threadId: 'th-override',
        permissionPreset: 'full-access',
        reasoningEffort: 'high',
      },
    })
    service.resolveRun(makeResult())
    await pending
    const [, , , req] = service.runMock.mock.calls[0]! as [unknown, unknown, string, CodexRunRequest]
    expect(req.collaborationMode).toBe('plan')
    expect(req.threadId).toBe('th-override')
    expect(req.permissionPreset).toBe('full-access')
    expect(req.reasoningEffort).toBe('high')
  })

  it('codex.mode=review routes to reviewCodexTurn with the target', async () => {
    const pending = backend.send({
      content: '/review',
      assistantMessageId: 'rev_1',
      codex: { mode: 'review', reviewTarget: { type: 'uncommittedChanges' }, permissionPreset: 'default' },
    })
    service.resolveRun(makeResult({ finalResponse: 'review done' }))
    await pending
    expect(service.reviewMock).toHaveBeenCalledOnce()
    expect(service.runMock).not.toHaveBeenCalled()
    const [, , , req] = service.reviewMock.mock.calls[0]! as [
      unknown,
      unknown,
      string,
      { target: { type: string }; messageId: string },
    ]
    expect(req.target).toEqual({ type: 'uncommittedChanges' })
    expect(req.messageId).toBe('rev_1')
  })

  it('codex.mode=review without target throws', async () => {
    await expect(backend.send({
      content: '/review',
      codex: { mode: 'review' },
    })).rejects.toThrow(/reviewTarget/)
  })

  it('codex.mode=compact routes to compactCodexTurn', async () => {
    const pending = backend.send({
      content: '/compact',
      assistantMessageId: 'comp_1',
      codex: { mode: 'compact' },
    })
    service.resolveRun(makeResult({ finalResponse: '' }))
    await pending
    expect(service.compactMock).toHaveBeenCalledOnce()
    expect(service.runMock).not.toHaveBeenCalled()
    const complete = events.find((e) => e.type === 'message_complete') as { metadata: { codex: { finalResponse: string } } }
    expect(complete.metadata.codex.finalResponse).toBe('Conversation compacted.')
  })

  it('maps bypassPermissions → full-access preset', async () => {
    await backend.close()
    backend = new CodexBackend(service)
    await backend.start(makeStartOpts({ permissionMode: 'bypassPermissions' }))
    const pending = backend.send({ content: 'x' })
    service.resolveRun(makeResult())
    await pending
    const request = (service.runMock.mock.calls[0] as [unknown, unknown, string, CodexRunRequest])[3]
    expect(request.permissionPreset).toBe('full-access')
  })

  it('emits message_start → status_change streaming → message_complete → status_change idle on success', async () => {
    const pending = backend.send({ content: 'hi' })
    service.resolveRun(makeResult({ finalResponse: 'bye', threadId: 'th-1', usage: null }))
    await pending

    const types = events.map((e) => e.type)
    expect(types).toEqual(['message_start', 'status_change', 'message_complete', 'status_change'])
    expect((events[1] as { status: string }).status).toBe('streaming')
    expect((events[3] as { status: string }).status).toBe('idle')
    const start = events[0] as { message: { id: string; role: string; providerId: string } }
    expect(start.message.role).toBe('assistant')
    expect(start.message.providerId).toBe('codex')
    const complete = events[2] as Record<string, unknown>
    expect(complete.type).toBe('message_complete')
    expect((complete.metadata as Record<string, unknown>).codex).toMatchObject({ finalResponse: 'bye', threadId: 'th-1' })
  })

  it('message_start id matches the messageId used in message_complete', async () => {
    const pending = backend.send({ content: 'x' })
    service.resolveRun(makeResult())
    await pending
    const start = events.find((e) => e.type === 'message_start') as { message: { id: string } }
    const complete = events.find((e) => e.type === 'message_complete') as { messageId: string }
    expect(start.message.id).toBe(complete.messageId)
  })

  it('emits message_error on non-interrupt failure', async () => {
    const pending = backend.send({ content: 'x' })
    service.rejectRun(new Error('boom'))
    await expect(pending).rejects.toThrow('boom')
    const types = events.map((e) => e.type)
    expect(types).toContain('message_error')
    expect(types[types.length - 1]).toBe('status_change')
  })

  it('emits message_interrupted when error mentions interrupt/abort', async () => {
    const pending = backend.send({ content: 'x' })
    service.rejectRun(new Error('Codex run interrupted'))
    await expect(pending).rejects.toThrow()
    const types = events.map((e) => e.type)
    expect(types).toContain('message_interrupted')
  })

  it('routes onItemDelta / onUsageDelta / onThreadStarted / permission / question via callbacks', async () => {
    const pending = backend.send({ content: 'x' })
    const cb = service.capturedCallbacks!
    expect(cb).toBeDefined()

    cb.onThreadStarted!('thread-99')
    cb.onItemDelta!('started', { type: 'agent_message', id: 'it-1', text: 'hello' } as CodexThreadItem)
    cb.onUsageDelta!({ lastInputTokens: 10, lastOutputTokens: 20, contextWindow: 0 } as CodexUsageInfo)
    cb.onMcpServerStatus!([{ name: 'superone', status: 'ready' }, { name: 'linear', status: 'starting' }])
    cb.onPermissionRequest!({ requestId: 'req-1', tool_name: 'bash', tool_input: {} } as unknown as PermissionRequest)
    cb.onAskUserQuestion!({ requestId: 'q-1', header: '', questions: [] } as unknown as AskUserQuestionRequest)

    service.resolveRun(makeResult())
    await pending

    const bodyTypes = events.map((e) => e.type)
    expect(bodyTypes).toContain('codex_thread_started')
    expect(bodyTypes).toContain('codex_item_delta')
    expect(bodyTypes).toContain('message_usage')
    expect(bodyTypes).toContain('permission_request')
    expect(bodyTypes).toContain('ask_user_question')
    const startupEvt = events.find((e) => e.type === 'codex_mcp_startup') as Extract<AgentEvent, { type: 'codex_mcp_startup' }> | undefined
    expect(startupEvt?.servers).toEqual([{ name: 'superone', status: 'ready' }, { name: 'linear', status: 'starting' }])
    expect(backend.getCurrentProviderSessionId()).toBe('thread-99')
  })

  it('providerSessionId listeners fire when onThreadStarted resolves a new thread id', async () => {
    const heard: string[] = []
    backend.onProviderSessionId((id) => heard.push(id))
    const pending = backend.send({ content: 'x' })
    service.capturedCallbacks!.onThreadStarted!('thread-A')
    service.capturedCallbacks!.onThreadStarted!('thread-A')
    service.resolveRun(makeResult())
    await pending
    expect(heard).toEqual(['thread-A'])
  })
})

describe('CodexBackend interrupt / approval forwarding', () => {
  let service: ReturnType<typeof makeFakeService>
  let backend: CodexBackend

  beforeEach(async () => {
    service = makeFakeService()
    backend = new CodexBackend(service)
    await backend.start(makeStartOpts())
  })

  it('interrupt() forwards to interruptCodex with session object', async () => {
    await backend.interrupt()
    expect(service.interruptMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }))
  })

  it('respondToPermission forwards allow + reason to respondToCodexPermission', () => {
    backend.respondToPermission('req-1', true, false, 'because')
    expect(service.respondPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'req-1', true, false, 'because', undefined, undefined)
  })

  it('respondToPermission forwards cancel decision through to respondToCodexPermission', () => {
    backend.respondToPermission('req-1', false, undefined, undefined, undefined, 'cancel')
    expect(service.respondPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'req-1', false, undefined, undefined, 'cancel', undefined)
  })

  it('respondToQuestion / dismissQuestion forward to codex-turn module', () => {
    backend.respondToQuestion('q-1', { a: 'yes' })
    backend.dismissQuestion('q-1')
    expect(service.respondQuestionMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'q-1', { a: 'yes' })
    expect(service.dismissQuestionMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'q-1')
  })

  it('handleCommand(codex.steer) forwards input to steerCodex', async () => {
    await backend.handleCommand({ kind: 'codex.steer', input: 'stop' })
    expect(service.steerMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'stop')
  })

  it('handleCommand(codex.steer) with newAssistantMessageId emits message_start + swaps current messageId for subsequent events', async () => {
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))

    const pending = backend.send({
      content: 'first',
      assistantMessageId: 'asst-1',
    })
    await Promise.resolve()
    events.length = 0

    await backend.handleCommand({
      kind: 'codex.steer',
      input: 'redirect',
      newAssistantMessageId: 'asst-2',
      newUserMessageId: 'user-2',
      newUserText: 'redirect',
    })

    const startEvt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }> | undefined
    expect(startEvt?.message.id).toBe('asst-2')

    service.capturedCallbacks?.onItemDelta?.('updated', {
      id: 'item-x', type: 'agent_message', text: 'after steer',
    } as unknown as CodexThreadItem)

    const deltaEvt = events.find((e) => e.type === 'codex_item_delta') as Extract<AgentEvent, { type: 'codex_item_delta' }> | undefined
    expect(deltaEvt?.messageId).toBe('asst-2')

    service.resolveRun(makeResult({ finalResponse: 'done' }))
    await pending

    const completes = events.filter(
      (e): e is Extract<AgentEvent, { type: 'message_complete' }> => e.type === 'message_complete',
    )
    // Steer finalizes the pre-steer bubble (asst-1) and the steered bubble
    // (asst-2) completes at turn end — each its own message_complete.
    expect(completes.map((e) => e.messageId)).toEqual(['asst-1', 'asst-2'])
    expect(service.steerMock).toHaveBeenCalledWith(expect.objectContaining({ projectPath: '/tmp/proj' }), 'redirect')
  })

  it('handleCommand(codex.plan_approval / codex.collaboration_mode_change) is a backend no-op', async () => {
    await expect(backend.handleCommand({ kind: 'codex.plan_approval', messageId: 'm-1', status: 'approved' })).resolves.toBeUndefined()
    await expect(backend.handleCommand({ kind: 'codex.collaboration_mode_change', mode: 'parallel' })).resolves.toBeUndefined()
    expect(service.steerMock).not.toHaveBeenCalled()
  })

  it('respondToPlanApproval is a no-op (not applicable to Codex)', () => {
    expect(() => backend.respondToPlanApproval('req', true, 'nope')).not.toThrow()
  })
})

describe('CodexBackend steer message attribution', () => {
  let service: ReturnType<typeof makeFakeService>
  let backend: CodexBackend
  let events: AgentEvent[]

  beforeEach(async () => {
    service = makeFakeService()
    backend = new CodexBackend(service)
    events = []
    backend.onEvent((e) => events.push(e))
    await backend.start(makeStartOpts())
  })

  function itemDeltas(messageId: string): Array<{ phase: string; id: string }> {
    return events
      .filter((e): e is Extract<AgentEvent, { type: 'codex_item_delta' }> => e.type === 'codex_item_delta')
      .filter((e) => e.messageId === messageId)
      .map((e) => ({ phase: e.phase, id: (e.item as { id: string }).id }))
  }

  function completeFor(messageId: string): Extract<AgentEvent, { type: 'message_complete' }> | undefined {
    return events
      .filter((e): e is Extract<AgentEvent, { type: 'message_complete' }> => e.type === 'message_complete')
      .find((e) => e.messageId === messageId)
  }

  function completeItemIds(messageId: string): string[] {
    const meta = completeFor(messageId)?.metadata as { codex?: { items?: Array<{ id: string }> } } | undefined
    return (meta?.codex?.items ?? []).map((i) => i.id)
  }

  it('keeps each bubble’s items isolated across a steer: pre-steer item completes into the pre-steer bubble, not the steered one', async () => {
    const pending = backend.send({ content: 'first task', assistantMessageId: 'A' })
    const cb = service.capturedCallbacks!
    expect(cb).toBeDefined()

    // Item starts under bubble A (before steer).
    cb.onItemDelta!('started', { id: 'item-A', type: 'agent_message', text: 'partial A' } as CodexThreadItem)

    // User steers mid-turn → new bubble B.
    await backend.handleCommand({
      kind: 'codex.steer',
      input: 'actually do this instead',
      newAssistantMessageId: 'B',
      newUserMessageId: 'U2',
      newUserText: 'actually do this instead',
    })

    // Codex finishes item-A *after* the steer (force-completed at turn end),
    // then streams a fresh item-B for the steered request.
    cb.onItemDelta!('completed', { id: 'item-A', type: 'agent_message', text: 'A done' } as CodexThreadItem)
    cb.onItemDelta!('started', { id: 'item-B', type: 'agent_message', text: 'answer B' } as CodexThreadItem)
    cb.onItemDelta!('completed', { id: 'item-B', type: 'agent_message', text: 'answer B' } as CodexThreadItem)

    service.resolveRun(makeResult({
      finalResponse: 'answer B',
      threadId: 'th-1',
      items: [
        { id: 'item-A', type: 'agent_message', text: 'A done' } as CodexThreadItem,
        { id: 'item-B', type: 'agent_message', text: 'answer B' } as CodexThreadItem,
      ],
    }))
    await pending

    // item-A deltas (incl. the post-steer completion) must stay attributed to A.
    expect(itemDeltas('A').map((d) => d.id)).toEqual(['item-A', 'item-A'])
    expect(itemDeltas('B').map((d) => d.id)).toEqual(['item-B', 'item-B'])

    // Bubble A must be finalized on steer with only its own items.
    expect(completeFor('A')).toBeDefined()
    expect(completeItemIds('A')).toEqual(['item-A'])

    // Bubble B's completion must contain only B's items (no merged turn dump).
    expect(completeFor('B')).toBeDefined()
    expect(completeItemIds('B')).toEqual(['item-B'])
  })
})

describe('CodexBackend unsupported operations degrade gracefully', () => {
  let backend: CodexBackend

  beforeEach(async () => {
    backend = new CodexBackend(makeFakeService())
    await backend.start(makeStartOpts())
  })

  it('rewindFiles returns canRewind:false', async () => {
    const result = await backend.rewindFiles('msg-1')
    expect(result.canRewind).toBe(false)
  })

  it('getMcpServerStatus returns empty without an active app-server connection', async () => {
    expect(await backend.getMcpServerStatus()).toEqual([])
  })

  it('getMcpServerStatus maps codex mcpServerStatus/list into shared McpServerInfo with correct auth semantics', async () => {
    const request = vi.fn(async () => ({
      data: [
        {
          // stdio server, up: serverInfo present, authStatus 'unsupported' (the normal stdio state)
          name: 'superone',
          serverInfo: { name: 'superone', version: '1.0.0' },
          tools: {
            widget_show: { name: 'widget_show', description: 'Render a widget' },
            session_rename: { name: 'session_rename' },
          },
          authStatus: 'unsupported',
        },
        // genuinely needs login → needs-auth
        { name: 'github', serverInfo: null, tools: {}, authStatus: 'notLoggedIn' },
        // 'oAuth' means LOGGED IN (has valid tokens), not needs-auth; not yet connected → failed
        { name: 'linear', serverInfo: null, tools: {}, authStatus: 'oAuth' },
        // authenticated via bearer token but not yet connected → failed (not needs-auth)
        { name: 'sentry', serverInfo: null, tools: {}, authStatus: 'bearerToken' },
        // stdio server not yet up (no serverInfo, no auth concept) → failed
        { name: 'broken', serverInfo: null, tools: {}, authStatus: 'unsupported' },
        // connected but server still reports it needs login → surface needs-auth over connected
        { name: 'notion', serverInfo: { name: 'notion' }, tools: {}, authStatus: 'notLoggedIn' },
      ],
    }))
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.threadId = 'th-9'

    const status = await backend.getMcpServerStatus()

    expect(request).toHaveBeenCalledWith('mcpServerStatus/list', { threadId: 'th-9', detail: 'full' })
    expect(status).toEqual([
      { name: 'superone', status: 'connected', toolCount: 2, tools: [
        { name: 'widget_show', description: 'Render a widget' },
        { name: 'session_rename' },
      ] },
      { name: 'github', status: 'needs-auth', toolCount: 0, tools: [] },
      { name: 'linear', status: 'failed', toolCount: 0, tools: [] },
      { name: 'sentry', status: 'failed', toolCount: 0, tools: [] },
      { name: 'broken', status: 'failed', toolCount: 0, tools: [] },
      { name: 'notion', status: 'needs-auth', toolCount: 0, tools: [] },
    ])
  })

  it('reloadMcpServers sends config/mcpServer/reload on the app-server connection', async () => {
    const request = vi.fn(async () => ({}))
    const session = (backend as unknown as { session: { connectionHandle: unknown; runningController: unknown } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.runningController = null

    await backend.reloadMcpServers()

    expect(request).toHaveBeenCalledWith('config/mcpServer/reload')
  })

  it('reloadMcpServers skips the global reload while a turn is running', async () => {
    const request = vi.fn(async () => ({}))
    const session = (backend as unknown as { session: { connectionHandle: unknown; runningController: unknown } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.runningController = new AbortController()

    await backend.reloadMcpServers()

    expect(request).not.toHaveBeenCalled()
  })

  it('reloadMcpServers is a no-op without an active connection', async () => {
    await expect(backend.reloadMcpServers()).resolves.toBeUndefined()
  })

  it('getMcpServerStatus returns empty when the request rejects', async () => {
    const request = vi.fn(async () => { throw new Error('mcp-registry busy') })
    const session = (backend as unknown as { session: { connectionHandle: unknown } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }

    expect(await backend.getMcpServerStatus()).toEqual([])
  })

  it('getContextUsage returns null', async () => {
    expect(await backend.getContextUsage()).toBeNull()
  })

  it('reloadPlugins returns false', async () => {
    expect(await backend.reloadPlugins()).toBe(false)
  })

  it('reconnectMcp throws', async () => {
    await expect(backend.reconnectMcp('srv')).rejects.toThrow(/not supported/)
  })
})

describe('CodexBackend event listeners', () => {
  it('onEvent forwards emitted events to listeners', async () => {
    const backend = new CodexBackend(makeFakeService())
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(makeStartOpts())
    backend.emitForTest({ type: 'status_change', status: 'streaming' })
    expect(events).toHaveLength(1)
  })

  it('onEvent returns unsubscribe', async () => {
    const backend = new CodexBackend(makeFakeService())
    const events: AgentEvent[] = []
    const unsub = backend.onEvent((e) => events.push(e))
    await backend.start(makeStartOpts())
    unsub()
    backend.emitForTest({ type: 'status_change', status: 'idle' })
    expect(events).toHaveLength(0)
  })
})

describe('CodexBackend idle dispose', () => {
  let service: ReturnType<typeof makeFakeService>
  let backend: CodexBackend
  let releaseAppServerSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    service = makeFakeService()
    releaseAppServerSpy = vi.fn()
    service.releaseAppServerConnection = releaseAppServerSpy
    backend = new CodexBackend(service)
  })

  function makeFakeHandle() {
    return {
      connection: {},
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
  }

  function getSession(): { connectionHandle: unknown; connectionAuth: unknown; runningController: AbortController | null } {
    return (backend as unknown as { session: { connectionHandle: unknown; connectionAuth: unknown; runningController: AbortController | null } }).session
  }

  it('isRuntimeIdle returns false when not started', () => {
    expect(backend.isRuntimeIdle(60_000)).toBe(false)
  })

  it('isRuntimeIdle returns false when session has no connection handle', async () => {
    await backend.start(makeStartOpts())
    expect(backend.isRuntimeIdle(0)).toBe(false)
  })

  it('isRuntimeIdle returns true when connection alive, no in-flight, and timeout elapsed', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    session.connectionHandle = makeFakeHandle()
    session.connectionAuth = { mode: 'auto' }
    expect(backend.isRuntimeIdle(0)).toBe(true)
  })

  it('isRuntimeIdle returns false within timeout window', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    session.connectionHandle = makeFakeHandle()
    session.connectionAuth = { mode: 'auto' }
    expect(backend.isRuntimeIdle(60_000)).toBe(false)
  })

  it('isRuntimeIdle returns false when runningController is set (in-flight turn)', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    session.connectionHandle = makeFakeHandle()
    session.connectionAuth = { mode: 'auto' }
    session.runningController = new AbortController()
    expect(backend.isRuntimeIdle(0)).toBe(false)
  })

  it('timer fires release after timeout, returning handle to project pool', async () => {
    vi.useFakeTimers()
    try {
      await backend.start(makeStartOpts())
      const session = getSession()
      session.connectionHandle = makeFakeHandle()
      session.connectionAuth = { mode: 'auto' }

      await vi.advanceTimersByTimeAsync(CodexBackend.IDLE_TIMEOUT_MS + CodexBackend.IDLE_CHECK_INTERVAL_MS + 100)

      expect(releaseAppServerSpy).toHaveBeenCalled()
      expect(session.connectionHandle).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('timer does not release while runningController is set', async () => {
    vi.useFakeTimers()
    try {
      await backend.start(makeStartOpts())
      const session = getSession()
      session.connectionHandle = makeFakeHandle()
      session.connectionAuth = { mode: 'auto' }
      session.runningController = new AbortController()

      await vi.advanceTimersByTimeAsync(CodexBackend.IDLE_TIMEOUT_MS + CodexBackend.IDLE_CHECK_INTERVAL_MS + 100)

      expect(releaseAppServerSpy).not.toHaveBeenCalled()
      expect(session.connectionHandle).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('close() stops idle timer so it no longer fires', async () => {
    vi.useFakeTimers()
    try {
      await backend.start(makeStartOpts())
      const session = getSession()
      session.connectionHandle = makeFakeHandle()
      session.connectionAuth = { mode: 'auto' }

      await backend.close()
      releaseAppServerSpy.mockClear()

      await vi.advanceTimersByTimeAsync(CodexBackend.IDLE_TIMEOUT_MS * 5)
      expect(releaseAppServerSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
