import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexRunRequest,
  CodexRunResult,
  CodexThreadItem,
  CodexUsageInfo,
  PermissionRequest,
} from '../../../shared/agent-types'
import type { BackendStartOptions } from '../types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../codex/codex-experiment-service', () => ({
  getSharedCodexService: vi.fn(),
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
  runMock: ReturnType<typeof vi.fn>
  reviewMock: ReturnType<typeof vi.fn>
  compactMock: ReturnType<typeof vi.fn>
  interruptMock: ReturnType<typeof vi.fn>
  resetMock: ReturnType<typeof vi.fn>
  respondPermissionMock: ReturnType<typeof vi.fn>
  respondQuestionMock: ReturnType<typeof vi.fn>
  dismissQuestionMock: ReturnType<typeof vi.fn>
  steerMock: ReturnType<typeof vi.fn>
  resolveRun: (result: CodexRunResult) => void
  rejectRun: (err: Error) => void
} {
  const state = {
    capturedCallbacks: undefined as CodexRunStreamCallbacksDeps | undefined,
    resolveRun: (_r: CodexRunResult) => {},
    rejectRun: (_e: Error) => {},
  }
  const captureImpl = (
    _sessionId: string,
    _projectPath: string,
    _request: CodexRunRequest,
    callbacks?: CodexRunStreamCallbacksDeps,
  ) => {
    state.capturedCallbacks = callbacks
    return new Promise<CodexRunResult>((resolve, reject) => {
      state.resolveRun = resolve
      state.rejectRun = reject
    })
  }
  const runMock = vi.fn(captureImpl)
  const reviewMock = vi.fn(captureImpl)
  const compactMock = vi.fn(captureImpl)
  const interruptMock = vi.fn(() => true)
  const resetMock = vi.fn()
  const respondPermissionMock = vi.fn()
  const respondQuestionMock = vi.fn()
  const dismissQuestionMock = vi.fn()
  const steerMock = vi.fn(async () => {})

  return {
    run: runMock as unknown as CodexServiceDeps['run'],
    review: reviewMock as unknown as CodexServiceDeps['review'],
    compact: compactMock as unknown as CodexServiceDeps['compact'],
    interrupt: interruptMock as unknown as CodexServiceDeps['interrupt'],
    reset: resetMock as unknown as CodexServiceDeps['reset'],
    respondToPermission: respondPermissionMock as unknown as CodexServiceDeps['respondToPermission'],
    respondToQuestion: respondQuestionMock as unknown as CodexServiceDeps['respondToQuestion'],
    dismissQuestion: dismissQuestionMock as unknown as CodexServiceDeps['dismissQuestion'],
    steer: steerMock as unknown as CodexServiceDeps['steer'],
    get capturedCallbacks() { return state.capturedCallbacks },
    runMock,
    reviewMock,
    compactMock,
    interruptMock,
    resetMock,
    respondPermissionMock,
    respondQuestionMock,
    dismissQuestionMock,
    steerMock,
    resolveRun: (r) => state.resolveRun(r),
    rejectRun: (e) => state.rejectRun(e),
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
    expect(service.resetMock).toHaveBeenCalledWith('sess-test')
  })

  it('send() throws when not started', async () => {
    await expect(backend.send({ content: 'x' })).rejects.toThrow(/not started/)
  })

  it('providerSessionId is preset from start opts', async () => {
    await backend.start({ ...makeStartOpts(), providerSessionId: 'thread-123' })
    expect(backend.getCurrentProviderSessionId()).toBe('thread-123')
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

  it('forwards prompt / images / model / effort / permissionPreset / threadId / cwd to codex service', async () => {
    const pending = backend.send({
      content: 'hello',
      model: 'gpt-5-max',
      effort: 'max',
      images: [{ name: 'a.png', mimeType: 'image/png', base64: 'xxx' }],
    })
    service.resolveRun(makeResult({ finalResponse: 'hi' }))
    await pending

    expect(service.runMock).toHaveBeenCalledOnce()
    const [sessionId, projectPath, request] = service.runMock.mock.calls[0]!
    expect(sessionId).toBe('sess-test')
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
    const [, , req] = service.runMock.mock.calls[0]!
    expect(req.messageId).toBe('renderer_msg_99')
    const start = events.find((e) => e.type === 'message_start') as { message: { id: string } }
    expect(start.message.id).toBe('renderer_msg_99')
  })

  it('request.codex.prompt overrides content for the Codex API request', async () => {
    const pending = backend.send({ content: 'user-visible text', codex: { prompt: 'codex-specific prompt' } })
    service.resolveRun(makeResult())
    await pending
    const [, , req] = service.runMock.mock.calls[0]!
    expect(req.prompt).toBe('codex-specific prompt')
  })

  it('passes codex-specific extras (collaborationMode / threadId / permissionPreset / reasoningEffort) to service.run', async () => {
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
    const [, , req] = service.runMock.mock.calls[0]!
    expect(req.collaborationMode).toBe('plan')
    expect(req.threadId).toBe('th-override')
    expect(req.permissionPreset).toBe('full-access')
    expect(req.reasoningEffort).toBe('high')
  })

  it('codex.mode=review routes to service.review with the target', async () => {
    const pending = backend.send({
      content: '/review',
      assistantMessageId: 'rev_1',
      codex: { mode: 'review', reviewTarget: { type: 'uncommittedChanges' }, permissionPreset: 'default' },
    })
    service.resolveRun(makeResult({ finalResponse: 'review done' }))
    await pending
    expect(service.reviewMock).toHaveBeenCalledOnce()
    expect(service.runMock).not.toHaveBeenCalled()
    const [, , req] = service.reviewMock.mock.calls[0]!
    expect(req.target).toEqual({ type: 'uncommittedChanges' })
    expect(req.messageId).toBe('rev_1')
  })

  it('codex.mode=review without target throws', async () => {
    await expect(backend.send({
      content: '/review',
      codex: { mode: 'review' },
    })).rejects.toThrow(/reviewTarget/)
  })

  it('codex.mode=compact routes to service.compact', async () => {
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
    const request = service.runMock.mock.calls[0]![2]
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
    expect(backend.getCurrentProviderSessionId()).toBe('thread-99')
  })

  it('providerSessionId listeners fire when onThreadStarted resolves a new thread id', async () => {
    const heard: string[] = []
    backend.onProviderSessionId((id) => heard.push(id))
    const pending = backend.send({ content: 'x' })
    service.capturedCallbacks!.onThreadStarted!('thread-A')
    service.capturedCallbacks!.onThreadStarted!('thread-A') // duplicate should de-dup
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

  it('interrupt() forwards to service with sessionKey', async () => {
    await backend.interrupt()
    expect(service.interruptMock).toHaveBeenCalledWith('sess-test')
  })

  it('respondToPermission forwards allow + reason to service', () => {
    backend.respondToPermission('req-1', true, false, 'because')
    expect(service.respondPermissionMock).toHaveBeenCalledWith('sess-test', 'req-1', true, false, 'because')
  })

  it('respondToQuestion / dismissQuestion forward to service', () => {
    backend.respondToQuestion('q-1', { a: 'yes' })
    backend.dismissQuestion('q-1')
    expect(service.respondQuestionMock).toHaveBeenCalledWith('sess-test', 'q-1', { a: 'yes' })
    expect(service.dismissQuestionMock).toHaveBeenCalledWith('sess-test', 'q-1')
  })

  it('steer() forwards input to service', async () => {
    await backend.steer('stop')
    expect(service.steerMock).toHaveBeenCalledWith('sess-test', 'stop')
  })

  it('respondToPlanApproval is a no-op (not applicable to Codex)', () => {
    expect(() => backend.respondToPlanApproval('req', true, 'nope')).not.toThrow()
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

  it('getMcpServerStatus returns empty', async () => {
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
