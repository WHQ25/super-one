import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexGoal,
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

const usageStatsMocks = vi.hoisted(() => ({
  recordCodexFromTurnUsage: vi.fn(),
  recordCodexFromUsage: vi.fn(),
}))

vi.mock('../../usage-stats-service', () => usageStatsMocks)

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
    startCodexQueuedTurn: vi.fn(async (
      _session: unknown,
      _auth: unknown,
      _projectPath: string,
      _cwd: string,
      callbacks?: { onQueuedMessageConsumed?: (clientMessageId: string) => void },
    ) => {
      callbacks?.onQueuedMessageConsumed?.('u2')
      return { threadId: 'thread-1', turnId: 'turn-2', finalResponse: 'queued done', usage: null, turnUsage: [], items: [] }
    }),
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
    buildCodexQueuedInput: (prompt: string) => [{ type: 'text', text: prompt, text_elements: [] }],
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
  startCodexQueuedTurn: turnMocks.startCodexQueuedTurn,
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
  buildCodexQueuedInput: turnMocks.buildCodexQueuedInput,
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

function makeGoal(status: CodexGoal['status']): CodexGoal {
  return {
    threadId: 'thread-xyz',
    objective: 'Ship the goal UX',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
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
  turnMocks.startCodexQueuedTurn.mockClear()
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
    await vi.waitFor(() => expect(service.runMock).toHaveBeenCalledOnce())
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

  it('preserves the server-resolved model when adopting a prewarmed thread', async () => {
    const handle = {
      connection: {},
      close: vi.fn(async () => {}),
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    const opts = makeStartOpts({ config: { apiKey: 'codex-key' } })
    turnMocks.prewarmCodexConnection.mockResolvedValueOnce(handle as never)
    turnMocks.prewarmCodexSession.mockImplementationOnce(async (
      _handle: unknown,
      session: { threadId: string | null; threadReady: boolean; model?: string },
    ) => {
      session.threadId = 'thread-prewarmed'
      session.threadReady = true
      session.model = 'gpt-5.6-sol'
      return 'thread-prewarmed'
    })

    backend.prewarm(opts)
    await backend.start(opts)

    const session = (backend as unknown as { session: { model?: string } }).session
    expect(session.model).toBe('gpt-5.6-sol')
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

  it('reports and releases a prewarmed handle through the shared runtime contract', async () => {
    const close = vi.fn(async () => {})
    const handle = {
      connection: {},
      close,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    turnMocks.prewarmCodexConnection.mockResolvedValueOnce(handle as never)

    backend.prewarm(makeStartOpts())
    await vi.waitFor(() => expect(backend.hasActiveRuntime()).toBe(true))
    await backend.releaseRuntime('idle')

    expect(close).toHaveBeenCalledOnce()
    expect(backend.hasActiveRuntime()).toBe(false)
  })

  it('does not close a connection created while an old prewarm release is pending', async () => {
    const oldClose = vi.fn(async () => {})
    const newClose = vi.fn(async () => {})
    const oldHandle = {
      connection: {},
      close: oldClose,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    let resolveOld!: (handle: typeof oldHandle) => void
    turnMocks.prewarmCodexConnection.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))

    backend.prewarm(makeStartOpts())
    const release = backend.releaseRuntime('idle')
    await backend.start(makeStartOpts())
    const session = (backend as unknown as {
      session: { connectionHandle: unknown; connectionAuth: unknown }
    }).session
    const newHandle = {
      connection: {},
      close: newClose,
      getStderr: () => '',
      onClosed: vi.fn(() => () => {}),
    }
    session.connectionHandle = newHandle
    session.connectionAuth = { mode: 'auto' }

    resolveOld(oldHandle)
    await release

    expect(oldClose).toHaveBeenCalledOnce()
    expect(newClose).not.toHaveBeenCalled()
    expect(session.connectionHandle).toBe(newHandle)
    expect(backend.hasActiveRuntime()).toBe(true)
  })

  it('closes an app-server connection on close instead of retaining it in the project pool', async () => {
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

    expect(releaseAppServerConnection).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
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
    usageStatsMocks.recordCodexFromTurnUsage.mockClear()
    usageStatsMocks.recordCodexFromUsage.mockClear()
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
    expect(request.reasoningEffort).toBe('max')
    expect(request.permissionPreset).toBe('default')
    expect(request.cwd).toBe('/tmp/proj')
    expect(request.messageId).toMatch(/^codex_/)
    expect(request.images).toHaveLength(1)
  })

  it('resumes a paused goal after a successful explicit turn', async () => {
    const controller = (backend as unknown as {
      goalController: {
        readonly goal: CodexGoal | null
        setStatus(threadId: string, status: CodexGoal['status']): Promise<CodexGoal | null>
      }
    }).goalController
    vi.spyOn(controller, 'goal', 'get').mockReturnValue(makeGoal('paused'))
    const setStatus = vi.spyOn(controller, 'setStatus').mockResolvedValue(makeGoal('active'))

    const pending = backend.send({ content: 'continue with this prompt' })
    service.resolveRun(makeResult({ threadId: 'thread-xyz' }))
    await pending

    expect(setStatus).toHaveBeenCalledWith('thread-xyz', 'active')
  })

  it('loads a persisted paused goal before deciding whether to resume it', async () => {
    const controller = (backend as unknown as {
      goalController: {
        readonly goal: CodexGoal | null
        get(threadId: string): Promise<CodexGoal | null>
        setStatus(threadId: string, status: CodexGoal['status']): Promise<CodexGoal | null>
      }
      session: { threadId: string | null }
    }).goalController
    const backendSession = (backend as unknown as { session: { threadId: string | null } }).session
    backendSession.threadId = 'thread-xyz'
    vi.spyOn(controller, 'goal', 'get')
      .mockReturnValueOnce(null)
      .mockReturnValue(makeGoal('paused'))
    const get = vi.spyOn(controller, 'get').mockResolvedValue(makeGoal('paused'))
    const setStatus = vi.spyOn(controller, 'setStatus').mockResolvedValue(makeGoal('active'))

    const pending = backend.send({ content: 'continue immediately after reload' })
    await vi.waitFor(() => expect(service.runMock).toHaveBeenCalledOnce())
    service.resolveRun(makeResult({ threadId: 'thread-xyz' }))
    await pending

    expect(get).toHaveBeenCalledWith('thread-xyz')
    expect(setStatus).toHaveBeenCalledWith('thread-xyz', 'active')
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
    service.capturedCallbacks?.onCompactionCompleted?.({
      trigger: 'manual',
      preTokens: 8_000,
      postTokens: 1_200,
      durationMs: 900,
    })
    service.resolveRun(makeResult({ finalResponse: '' }))
    await pending
    expect(service.compactMock).toHaveBeenCalledOnce()
    expect(service.runMock).not.toHaveBeenCalled()
    const complete = events.find((e) => e.type === 'message_complete') as { metadata: { codex: { finalResponse: string } } }
    expect(complete.metadata.codex.finalResponse).toBe('Conversation compacted.')
    expect(events).toContainEqual({ type: 'status_indicator', indicator: 'compacting' })
    expect(events).toContainEqual({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 8_000,
      postTokens: 1_200,
      durationMs: 900,
      messageId: 'comp_1',
    })
    expect(events).toContainEqual({ type: 'status_indicator', indicator: null, compactResult: 'success' })
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

  it('attributes partial failed-turn usage to the server-resolved model', async () => {
    const pending = backend.send({ content: 'x' })
    const session = (backend as unknown as { session: { model?: string } }).session
    session.model = 'gpt-5.6-sol'
    service.capturedCallbacks!.onUsageAccounted!('thread-xyz', {
      totalInputTokens: 30,
      totalCachedInputTokens: 10,
      totalOutputTokens: 5,
      lastInputTokens: 30,
      lastCachedInputTokens: 10,
      lastOutputTokens: 5,
      reasoningOutputTokens: 0,
      contextWindow: 128_000,
    })
    service.rejectRun(new Error('boom'))

    await expect(pending).rejects.toThrow('boom')
    expect(usageStatsMocks.recordCodexFromTurnUsage).toHaveBeenCalledWith(
      {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 0,
      },
      null,
      'gpt-5.6-sol',
      expect.any(Date),
    )
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

  it('persists queued sends and swaps bubbles when Core consumes the client message id', async () => {
    const pending = backend.send({ content: 'first', assistantMessageId: 'a1' })
    const request = vi.fn(async (method: string) => method === 'thread/queue/add'
      ? { queuedSubmission: { id: 'submission-2' } }
      : {})
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.threadId = 'thread-1'

    await backend.send({ content: 'second', priority: 'next', clientMessageId: 'u2', assistantMessageId: 'a2' })
    expect(request).toHaveBeenCalledWith('thread/queue/add', expect.objectContaining({
      threadId: 'thread-1', clientUserMessageId: 'u2',
    }))
    expect(service.capturedCallbacks?.hasQueuedMessages?.()).toBe(true)
    service.capturedCallbacks?.onQueuedMessageConsumed?.('u2')
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'u2' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_start', message: expect.objectContaining({ id: 'a2' }) }))
    expect(service.capturedCallbacks?.hasQueuedMessages?.()).toBe(false)

    service.resolveRun(makeResult())
    await pending
  })

  it('waits for Core to confirm durable queue deletion before removing it locally', async () => {
    const pending = backend.send({ content: 'first', assistantMessageId: 'a1' })
    const request = vi.fn(async (method: string) => method === 'thread/queue/add'
      ? { queuedSubmission: { id: 'submission-2' } }
      : {})
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.threadId = 'thread-1'
    await backend.send({ content: 'second', priority: 'next', clientMessageId: 'u2', assistantMessageId: 'a2' })

    await expect(backend.dequeueMessage('u2')).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith('thread/queue/delete', {
      threadId: 'thread-1', queuedSubmissionId: 'submission-2',
    })
    expect(service.capturedCallbacks?.hasQueuedMessages?.()).toBe(false)

    service.resolveRun(makeResult())
    await pending
  })

  it('keeps a promoted queue entry until its userMessage item is observed', async () => {
    const request = vi.fn(async (method: string) => method === 'thread/queue/list'
      ? { data: [], nextCursor: null }
      : {})
    const internals = backend as unknown as {
      activeRun: Promise<void> | null
      durableQueue: Map<string, { submissionId: string; request: { content: string; assistantMessageId: string } }>
      restoreDurableQueue(): Promise<void>
      session: { connectionHandle: unknown; threadId: string | null }
    }
    internals.session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    internals.session.threadId = 'thread-1'
    internals.activeRun = Promise.resolve()
    internals.durableQueue.set('u2', {
      submissionId: 'submission-2',
      request: { content: 'second', assistantMessageId: 'a2' },
    })

    await internals.restoreDurableQueue()

    expect(internals.durableQueue.has('u2')).toBe(true)
    expect(events).toContainEqual({
      type: 'queued_messages_restored',
      messages: [{ clientMessageId: 'u2', content: 'second' }],
    })
  })

  it('resumes an interrupted durable queue and consumes its first message', async () => {
    const internals = backend as unknown as {
      durableQueue: Map<string, { submissionId: string; request: { content: string; assistantMessageId: string } }>
    }
    internals.durableQueue.set('u2', {
      submissionId: 'submission-2',
      request: { content: 'second', assistantMessageId: 'a2' },
    })

    await expect(backend.startQueuedMessages()).resolves.toBe(true)

    expect(turnMocks.startCodexQueuedTurn).toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'u2' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_complete', messageId: 'a2' }))
  })

  it('finalizes each assistant segment while manually draining multiple queued messages', async () => {
    const internals = backend as unknown as {
      durableQueue: Map<string, { submissionId: string; request: { content: string; assistantMessageId: string } }>
    }
    internals.durableQueue.set('u2', {
      submissionId: 'submission-2',
      request: { content: 'second', assistantMessageId: 'a2' },
    })
    internals.durableQueue.set('u3', {
      submissionId: 'submission-3',
      request: { content: 'third', assistantMessageId: 'a3' },
    })
    turnMocks.startCodexQueuedTurn.mockImplementationOnce(async (
      _session: unknown,
      _auth: unknown,
      _projectPath: string,
      _cwd: string,
      callbacks?: {
        onQueuedMessageConsumed?: (clientMessageId: string) => void
        onTurnCompleted?: (info: { turnId?: string }) => void
      },
    ) => {
      callbacks?.onQueuedMessageConsumed?.('u2')
      callbacks?.onTurnCompleted?.({ turnId: 'turn-2' })
      callbacks?.onQueuedMessageConsumed?.('u3')
      return { threadId: 'thread-1', turnId: 'turn-3', finalResponse: 'third done', usage: null, turnUsage: [], items: [] }
    })

    await expect(backend.startQueuedMessages()).resolves.toBe(true)

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_complete',
      messageId: 'a2',
      metadata: expect.objectContaining({ codex: expect.objectContaining({ turnId: 'turn-2' }) }),
    }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'message_complete', messageId: 'a3' }))
  })

  it('rejects when manual durable queue draining fails', async () => {
    const internals = backend as unknown as {
      durableQueue: Map<string, { submissionId: string; request: { content: string; assistantMessageId: string } }>
    }
    internals.durableQueue.set('u2', {
      submissionId: 'submission-2',
      request: { content: 'second', assistantMessageId: 'a2' },
    })
    turnMocks.startCodexQueuedTurn.mockRejectedValueOnce(new Error('queue drain failed'))

    await expect(backend.startQueuedMessages()).rejects.toThrow('queue drain failed')
  })

  it('records the whole turn usage instead of only the final response snapshot', async () => {
    const pending = backend.send({ content: 'x' })
    const finalSnapshot = {
      totalInputTokens: 180,
      totalCachedInputTokens: 80,
      totalOutputTokens: 30,
      lastInputTokens: 80,
      lastCachedInputTokens: 50,
      lastOutputTokens: 10,
      reasoningOutputTokens: 0,
      contextWindow: 128_000,
    }
    service.capturedCallbacks!.onUsageAccounted!('thread-xyz', {
      ...finalSnapshot,
      lastInputTokens: 100,
      lastCachedInputTokens: 30,
      lastOutputTokens: 20,
    })
    service.capturedCallbacks!.onUsageAccounted!('fork-thread', finalSnapshot)
    const rootTurnUsage = {
      inputTokens: 70,
      outputTokens: 20,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 0,
    }

    service.resolveRun(makeResult({ usage: finalSnapshot, turnUsage: rootTurnUsage }))
    await pending

    expect(usageStatsMocks.recordCodexFromTurnUsage).toHaveBeenCalledWith(
      {
        inputTokens: 100,
        outputTokens: 30,
        cacheReadInputTokens: 80,
        cacheCreationInputTokens: 0,
      },
      finalSnapshot,
      'gpt-5.4',
      expect.any(Date),
    )

    const lateChildUsage = { ...finalSnapshot, totalInputTokens: 260, totalOutputTokens: 40 }
    service.capturedCallbacks!.onUsageAccounted!('fork-thread', lateChildUsage)
    expect(usageStatsMocks.recordCodexFromUsage).toHaveBeenCalledWith(
      lateChildUsage,
      'gpt-5.4',
      expect.any(Date),
    )
  })

  it('attributes usage and message metadata to the server-resolved model', async () => {
    await backend.close()
    service = makeFakeService()
    backend = new CodexBackend(service)
    events = []
    backend.onEvent((event) => events.push(event))
    await backend.start(makeStartOpts({ config: { apiKey: 'codex-key' } }))

    const usage = {
      totalInputTokens: 30,
      totalCachedInputTokens: 10,
      totalOutputTokens: 5,
      lastInputTokens: 30,
      lastCachedInputTokens: 10,
      lastOutputTokens: 5,
      reasoningOutputTokens: 0,
      contextWindow: 128_000,
    }
    const pending = backend.send({ content: 'use the server default' })
    const session = (backend as unknown as { session: { model?: string } }).session
    session.model = 'gpt-5.6-sol'
    service.resolveRun(makeResult({ usage }))
    await pending

    expect(usageStatsMocks.recordCodexFromTurnUsage).toHaveBeenCalledWith(
      undefined,
      usage,
      'gpt-5.6-sol',
      expect.any(Date),
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message_complete',
      metadata: expect.objectContaining({
        codex: expect.objectContaining({ model: 'gpt-5.6-sol' }),
      }),
    }))
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

  it('pauses an active goal before interrupting its current turn', async () => {
    const controller = (backend as unknown as {
      goalController: {
        readonly goal: CodexGoal | null
        pause(): Promise<CodexGoal | null>
      }
    }).goalController
    vi.spyOn(controller, 'goal', 'get').mockReturnValue(makeGoal('active'))
    const pause = vi.spyOn(controller, 'pause').mockResolvedValue(makeGoal('paused'))

    await backend.interrupt()

    expect(pause).toHaveBeenCalledOnce()
    expect(service.interruptMock).toHaveBeenCalledOnce()
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(service.interruptMock.mock.invocationCallOrder[0]!)
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

  it('injectTaskNotification steers when a turn is active', async () => {
    const pending = backend.send({ content: 'first', assistantMessageId: 'asst-1' })
    await Promise.resolve()
    const session = (backend as unknown as { session: { steerFn: ((text: string) => Promise<void>) | null } }).session
    session.steerFn = async () => {}

    // 'sent-inline': steer bypasses Session.send, so Session owes the transcript bubble.
    expect(await backend.injectTaskNotification('mailbox ready')).toBe('sent-inline')

    expect(service.steerMock).toHaveBeenCalledWith(expect.any(Object), 'mailbox ready')
    expect(service.runMock).toHaveBeenCalledTimes(1)

    service.resolveRun(makeResult())
    await pending
  })

  it('injectTaskNotification queues while busy without steerFn and flushes after turn ends', async () => {
    const pending = backend.send({ content: 'first', assistantMessageId: 'asst-1' })
    await Promise.resolve()
    expect(service.runMock).toHaveBeenCalledTimes(1)

    await backend.injectTaskNotification('wake once')
    await backend.injectTaskNotification('wake once')
    await backend.injectTaskNotification('wake twice')
    expect(service.runMock).toHaveBeenCalledTimes(1)
    expect(service.steerMock).not.toHaveBeenCalled()

    service.resolveRun(makeResult({ finalResponse: 'done' }))
    await pending
    await vi.waitFor(() => expect(service.runMock).toHaveBeenCalledTimes(2))

    const secondRequest = service.runMock.mock.calls[1]?.[3] as CodexRunRequest
    expect(secondRequest.prompt).toBe('wake once\n\nwake twice')
    service.resolveRun(makeResult({ finalResponse: 'woke' }))
    await vi.waitFor(() => expect(service.runMock.mock.results[1]?.type).toBe('return'))
  })

  it('injectTaskNotification returns unhandled when idle so Session.send owns the turn', async () => {
    const handled = await backend.injectTaskNotification('idle wake')
    expect(handled).toBe('unhandled')
    expect(service.runMock).not.toHaveBeenCalled()
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
      { name: 'superone', status: 'connected', authStatus: 'unknown', fetchedAt: expect.any(Number), toolCount: 2, tools: [
        { name: 'widget_show', description: 'Render a widget' },
        { name: 'session_rename' },
      ] },
      { name: 'github', status: 'needs-auth', authStatus: 'needs-auth', fetchedAt: expect.any(Number), toolCount: 0, tools: [] },
      { name: 'linear', status: 'failed', authStatus: 'authenticated', fetchedAt: expect.any(Number), toolCount: 0, tools: [] },
      { name: 'sentry', status: 'failed', authStatus: 'authenticated', fetchedAt: expect.any(Number), toolCount: 0, tools: [] },
      { name: 'broken', status: 'failed', authStatus: 'unknown', fetchedAt: expect.any(Number), toolCount: 0, tools: [] },
      { name: 'notion', status: 'needs-auth', authStatus: 'needs-auth', fetchedAt: expect.any(Number), toolCount: 0, tools: [] },
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

  it('maps the latest Codex token snapshot into detailed context usage', async () => {
    const internals = backend as unknown as { lastUsageSnapshot: CodexUsageInfo; session: { model?: string } }
    internals.session.model = 'gpt-next'
    internals.lastUsageSnapshot = {
      totalInputTokens: 90, totalCachedInputTokens: 30, totalOutputTokens: 8,
      lastInputTokens: 90, lastCachedInputTokens: 30, lastOutputTokens: 8,
      reasoningOutputTokens: 0, contextWindow: 120,
    }
    expect(await backend.getContextUsage()).toMatchObject({
      totalTokens: 90, maxTokens: 120, percentage: 75, model: 'gpt-next',
    })
  })

  it('reverts paginated conversation history without claiming file rewind', async () => {
    const request = vi.fn(async () => ({ thread: { id: 'thread-1' } }))
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.threadId = 'thread-1'
    await expect(backend.rewindConversation('turn-2')).resolves.toEqual({ canRewind: true, supportsCodeOnly: false })
    expect(request).toHaveBeenCalledWith('thread/revert', { threadId: 'thread-1', beforeTurnId: 'turn-2' })
  })

  it('refuses to rewind while durable queued messages are pending', async () => {
    const request = vi.fn(async () => ({}))
    const internals = backend as unknown as {
      session: { connectionHandle: unknown; threadId: string | null }
      durableQueue: Map<string, { submissionId: string; request: { content: string } }>
    }
    internals.session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    internals.session.threadId = 'thread-1'
    internals.durableQueue.set('u2', { submissionId: 'submission-2', request: { content: 'queued' } })

    await expect(backend.rewindConversation('turn-2')).resolves.toEqual({
      canRewind: false,
      error: 'Cannot rewind while Codex queued messages are pending',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('forks before the target turn when reverting a legacy thread', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/revert') throw new Error('thread/revert only supports paginated threads')
      if (method === 'thread/fork') return { thread: { id: 'thread-forked' } }
      return {}
    })
    const session = (backend as unknown as { session: { connectionHandle: unknown; threadId: string | null } }).session
    session.connectionHandle = { connection: { request }, close: vi.fn(), getStderr: () => '', onClosed: vi.fn(() => () => {}) }
    session.threadId = 'thread-legacy'

    await expect(backend.rewindConversation('turn-2')).resolves.toEqual({ canRewind: true, supportsCodeOnly: false })
    expect(request).toHaveBeenNthCalledWith(1, 'thread/revert', { threadId: 'thread-legacy', beforeTurnId: 'turn-2' })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/fork', { threadId: 'thread-legacy', beforeTurnId: 'turn-2' })
    expect(backend.getCurrentProviderSessionId()).toBe('thread-forked')
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
  let backend: CodexBackend

  beforeEach(() => {
    backend = new CodexBackend(makeFakeService())
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

  it('reports no runtime before a connection is attached', async () => {
    expect(backend.hasActiveRuntime()).toBe(false)
    await backend.start(makeStartOpts())
    expect(backend.hasActiveRuntime()).toBe(false)
  })

  it('reports an attached app-server connection as active', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    session.connectionHandle = makeFakeHandle()
    session.connectionAuth = { mode: 'auto' }
    expect(backend.hasActiveRuntime()).toBe(true)
  })

  it('releaseRuntime closes the connection instead of returning it to a pool', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    const handle = makeFakeHandle()
    session.connectionHandle = handle
    session.connectionAuth = { mode: 'auto' }

    await backend.releaseRuntime('idle')

    expect(handle.close).toHaveBeenCalledOnce()
    expect(session.connectionHandle).toBeNull()
    expect(backend.hasActiveRuntime()).toBe(false)
  })

  it('does not release while a turn owns the connection', async () => {
    await backend.start(makeStartOpts())
    const session = getSession()
    const handle = makeFakeHandle()
    session.connectionHandle = handle
    session.connectionAuth = { mode: 'auto' }
    session.runningController = new AbortController()

    await backend.releaseRuntime('idle')

    expect(handle.close).not.toHaveBeenCalled()
    expect(session.connectionHandle).toBe(handle)
  })
})
