import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'

const hoisted = vi.hoisted(() => {
  interface Captured {
    emit: ((e: AgentEvent) => void) | null
    onSessionId: ((id: string) => void) | null
    onQueuedTurnStart: ((messageId: string) => void) | null
    onStepBoundary: (() => void) | null
    getInterrupted: (() => boolean) | null
    getCurrentMessageId: (() => string) | null
    bridge: unknown
    iterationDone: { resolve: () => void; promise: Promise<void> } | null
    activeBackgroundTasks: Map<string, { toolUseId?: string; description: string }> | null
    createSessionQueryMock: ReturnType<typeof vi.fn>
    buildClaudeOptionsMock: ReturnType<typeof vi.fn>
    warmupPrewarm: ReturnType<typeof vi.fn>
    warmupDispose: ReturnType<typeof vi.fn>
    mockQueryInterrupt: ReturnType<typeof vi.fn>
    mockQueryCancelAsyncMessage: ReturnType<typeof vi.fn>
    mockQueryClose: ReturnType<typeof vi.fn>
    mockQuerySetModel: ReturnType<typeof vi.fn>
    mockQueryRewindFiles: ReturnType<typeof vi.fn>
    mockQueryGetContextUsage: ReturnType<typeof vi.fn>
    mockQueryMcpServerStatus: ReturnType<typeof vi.fn>
    mockQueryReconnectMcpServer: ReturnType<typeof vi.fn>
    mockQueryToggleMcpServer: ReturnType<typeof vi.fn>
    mockQueryReloadPlugins: ReturnType<typeof vi.fn>
  }
  const captured: Captured = {
    emit: null,
    onSessionId: null,
    onQueuedTurnStart: null,
    onStepBoundary: null,
    getInterrupted: null,
    getCurrentMessageId: null,
    bridge: null,
    iterationDone: null,
    activeBackgroundTasks: null,
    createSessionQueryMock: vi.fn(),
    buildClaudeOptionsMock: vi.fn((opts: unknown) => ({ __built: opts })),
    warmupPrewarm: vi.fn(),
    warmupDispose: vi.fn(),
    mockQueryInterrupt: vi.fn(async () => ({ still_queued: [] })),
    mockQueryCancelAsyncMessage: vi.fn(async () => true),
    mockQueryClose: vi.fn(),
    mockQuerySetModel: vi.fn(async () => {}),
    mockQueryRewindFiles: vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'], insertions: 1, deletions: 0 })),
    mockQueryGetContextUsage: vi.fn(async () => ({ categories: [{ name: 'system', tokens: 5, color: '#fff' }], totalTokens: 5, maxTokens: 100, percentage: 5, model: 'claude' })),
    mockQueryMcpServerStatus: vi.fn(async () => []),
    mockQueryReconnectMcpServer: vi.fn(async () => {}),
    mockQueryToggleMcpServer: vi.fn(async () => {}),
    mockQueryReloadPlugins: vi.fn(async () => {}),
  }
  captured.createSessionQueryMock.mockImplementation(
    (bridge: unknown, opts: unknown, emit: (e: AgentEvent) => void, getMid: () => string, _getTs: () => number, getInterrupted: () => boolean, onSessionId: (id: string) => void, onQueuedTurnStart: (id: string) => void, onStepBoundary: () => void) => {
      captured.emit = emit
      captured.onSessionId = onSessionId
      captured.onQueuedTurnStart = onQueuedTurnStart
      captured.onStepBoundary = onStepBoundary
      captured.getInterrupted = getInterrupted
      captured.getCurrentMessageId = getMid
      captured.bridge = bridge
      let resolveIter: () => void = () => {}
      const promise = new Promise<void>((resolve) => { resolveIter = resolve })
      captured.iterationDone = { resolve: resolveIter, promise }
      captured.activeBackgroundTasks = new Map()
      return {
        activeBackgroundTasks: captured.activeBackgroundTasks,
        query: {
          interrupt: captured.mockQueryInterrupt,
          cancelAsyncMessage: captured.mockQueryCancelAsyncMessage,
          close: captured.mockQueryClose,
          setModel: captured.mockQuerySetModel,
          rewindFiles: captured.mockQueryRewindFiles,
          getContextUsage: captured.mockQueryGetContextUsage,
          mcpServerStatus: captured.mockQueryMcpServerStatus,
          reconnectMcpServer: captured.mockQueryReconnectMcpServer,
          toggleMcpServer: captured.mockQueryToggleMcpServer,
          reloadPlugins: captured.mockQueryReloadPlugins,
        },
        iterationDone: promise,
        spawnAbortController: (opts as { abortController?: AbortController }).abortController ?? new AbortController(),
      }
    }
  )
  return { captured }
})

vi.mock('../../agent/claude-query', () => ({
  createSessionQuery: hoisted.captured.createSessionQueryMock,
  buildClaudeOptions: hoisted.captured.buildClaudeOptionsMock,
  buildUserMessage: vi.fn((request: SendMessageRequest, sessionId: string) => ({
    type: 'user',
    message: { role: 'user', content: request.content },
    parent_tool_use_id: null,
    session_id: sessionId,
  })),
}))

vi.mock('../../agent/warmup-manager', () => {
  const SharedWarmupManager = Object.assign(class {
    prewarm = hoisted.captured.warmupPrewarm
    consume = () => null
    dispose = hoisted.captured.warmupDispose
  }, {
    keyOf: (opts: { __built?: { model?: string; effort?: string; permissionMode?: string; resume?: string } } & { model?: string; effort?: string; permissionMode?: string; resume?: string }) => {
      const o = opts?.__built ?? opts
      return JSON.stringify({ m: o?.model ?? '', e: o?.effort ?? '', p: o?.permissionMode ?? '', r: o?.resume ?? '' })
    },
  })
  const singleton = new SharedWarmupManager()
  return {
    WarmupManager: SharedWarmupManager,
    getGlobalWarmupManager: () => singleton,
    disposeGlobalWarmupManager: () => singleton.dispose(),
  }
})

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

const proxyHoisted = vi.hoisted(() => ({
  ensureProxyMock: vi.fn(async () => ({ url: 'http://127.0.0.1:45001', port: 45001 })),
}))

vi.mock('../../providers/llm-proxy-manager', () => ({
  ensureProxy: proxyHoisted.ensureProxyMock,
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
  dedupePath: vi.fn((p: string) => p),
  fixPath: vi.fn(),
}))

const permissionHoisted = vi.hoisted(() => ({
  createCanUseToolMock: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  rejectAllPendingMock: vi.fn(),
}))

vi.mock('../../agent/claude-permissions', () => ({
  createCanUseTool: permissionHoisted.createCanUseToolMock,
  createOnElicitation: vi.fn(() => vi.fn()),
  respondToElicitation: vi.fn(),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: permissionHoisted.rejectAllPendingMock,
}))

import { ClaudeBackend } from './claude-backend'

function makeStartOpts() {
  return {
    sessionId: 'sess-test',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    config: { apiKey: 'sk-test' },
    permissionMode: 'default' as const,
    abortController: new AbortController(),
  }
}

describe('ClaudeBackend', () => {
  beforeEach(() => {
    hoisted.captured.emit = null
    hoisted.captured.onSessionId = null
    hoisted.captured.onQueuedTurnStart = null
    hoisted.captured.onStepBoundary = null
    hoisted.captured.getInterrupted = null
    hoisted.captured.getCurrentMessageId = null
    hoisted.captured.bridge = null
    hoisted.captured.iterationDone = null
    hoisted.captured.createSessionQueryMock.mockClear()
    hoisted.captured.buildClaudeOptionsMock.mockClear()
    hoisted.captured.warmupPrewarm.mockClear()
    hoisted.captured.warmupDispose.mockClear()
    hoisted.captured.mockQueryInterrupt.mockClear()
    hoisted.captured.mockQueryCancelAsyncMessage.mockClear()
    hoisted.captured.mockQueryClose.mockClear()
    hoisted.captured.mockQuerySetModel.mockClear()
    hoisted.captured.mockQueryRewindFiles.mockClear()
    hoisted.captured.mockQueryGetContextUsage.mockClear()
    hoisted.captured.mockQueryMcpServerStatus.mockClear()
    hoisted.captured.mockQueryReconnectMcpServer.mockClear()
    hoisted.captured.mockQueryToggleMcpServer.mockClear()
    hoisted.captured.mockQueryReloadPlugins.mockClear()
    permissionHoisted.createCanUseToolMock.mockClear()
    permissionHoisted.createCanUseToolMock.mockImplementation(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() }))
    permissionHoisted.rejectAllPendingMock.mockClear()
    proxyHoisted.ensureProxyMock.mockClear()
  })

  describe('lifecycle', () => {
    it('start() spawns a session query via createSessionQuery', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledOnce()
    })

    it('start() throws if called twice without close', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      await expect(backend.start(makeStartOpts())).rejects.toThrow(/already started/)
    })

    it('close() releases bridge and query', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await backend.close()
      expect(hoisted.captured.mockQueryClose).toHaveBeenCalled()
    })

    it('maps apiKey and baseUrl from config into env', async () => {
      const backend = new ClaudeBackend()
      await backend.start({
        ...makeStartOpts(),
        config: { apiKey: 'sk-abc', baseUrl: 'https://proxy.example.com', extraEnv: { CUSTOM_VAR: 'x' } },
      })
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      const env = (opts as { env?: Record<string, string | undefined> }).env
      expect(env).toMatchObject({
        ANTHROPIC_API_KEY: 'sk-abc',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        CUSTOM_VAR: 'x',
      })
      expect(env?.PATH?.split(':')).toEqual(expect.arrayContaining(process.env.PATH!.split(':')))
    })

    it('inherits PATH so spawned bash can find git under a custom provider', async () => {
      const backend = new ClaudeBackend()
      await backend.start({
        ...makeStartOpts(),
        config: { baseUrl: 'https://proxy.example.com' },
      })
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      const env = (opts as { env?: Record<string, string | undefined> }).env
      expect(env?.PATH?.split(':')).toEqual(expect.arrayContaining(process.env.PATH!.split(':')))
      expect(env?.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com')
    })

    it('leaves env undefined when provider config carries no env keys (SDK inherits process.env)', async () => {
      const backend = new ClaudeBackend()
      await backend.start({ ...makeStartOpts(), config: {} })
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      expect((opts as { env?: unknown }).env).toBeUndefined()
    })
  })

  describe('event forwarding', () => {
    it('onEvent subscribers receive events emitted via the SDK loop', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())
      hoisted.captured.emit?.({ type: 'status_change', status: 'streaming' })
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('status_change')
    })

    it('onEvent returns an unsubscribe function', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      const unsub = backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())
      unsub()
      hoisted.captured.emit?.({ type: 'status_change', status: 'idle' })
      expect(events).toHaveLength(0)
    })

    it('onProviderSessionId fires when SDK emits system.init sessionId', async () => {
      const backend = new ClaudeBackend()
      const ids: string[] = []
      backend.onProviderSessionId((id) => ids.push(id))
      await backend.start(makeStartOpts())
      hoisted.captured.onSessionId?.('sdk-sid-abc')
      expect(ids).toEqual(['sdk-sid-abc'])
      expect(backend.getCurrentProviderSessionId()).toBe('sdk-sid-abc')
    })

    it('keeps the resumed provider session id while a replacement run has produced no content', async () => {
      const backend = new ClaudeBackend()
      const ids: string[] = []
      backend.onProviderSessionId((id) => ids.push(id))
      await backend.start({ ...makeStartOpts(), providerSessionId: 'sdk-known-good' })

      hoisted.captured.onSessionId?.('sdk-fresh-empty')

      expect(ids).toEqual([])
      expect(backend.getCurrentProviderSessionId()).toBe('sdk-known-good')
    })

    it('adopts the replacement provider session id once the run streams content', async () => {
      const backend = new ClaudeBackend()
      const ids: string[] = []
      backend.onProviderSessionId((id) => ids.push(id))
      await backend.start({ ...makeStartOpts(), providerSessionId: 'sdk-known-good' })
      hoisted.captured.onSessionId?.('sdk-fresh-real')

      hoisted.captured.emit?.({
        type: 'content_delta',
        messageId: 'msg-1',
        delta: { type: 'text', text: 'hi' },
      } as AgentEvent)

      expect(ids).toEqual(['sdk-fresh-real'])
      expect(backend.getCurrentProviderSessionId()).toBe('sdk-fresh-real')
    })

    it('drops the staged provider session id when the runtime is released before any content', async () => {
      const backend = new ClaudeBackend()
      await backend.start({ ...makeStartOpts(), providerSessionId: 'sdk-known-good' })
      hoisted.captured.onSessionId?.('sdk-fresh-empty')
      hoisted.captured.iterationDone?.resolve()
      await backend.close()

      expect(backend.getCurrentProviderSessionId()).toBe('sdk-known-good')
    })
  })

  describe('openai-chat proxy provider', () => {
    it('stops routing through the sidecar after switching back to a provider without a proxy', async () => {
      const backend = new ClaudeBackend()
      await backend.start({
        ...makeStartOpts(),
        config: { apiKey: 'sk-superone-proxy', proxy: { name: 'p', api_base_url: 'https://up/chat/completions', api_key: 'k', models: ['m'] } },
      })
      hoisted.captured.iterationDone?.resolve()
      await backend.close()

      await backend.start({ ...makeStartOpts(), config: {} })

      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
      const env = (opts as { env?: Record<string, string | undefined> }).env
      expect(env?.ANTHROPIC_BASE_URL).toBeUndefined()
    })
  })

  describe('send()', () => {
    it('emits message_start and status_change, pushes user message, resolves on message_complete', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const sendPromise = backend.send({ content: 'hello' })
      await new Promise((r) => setTimeout(r, 0))

      const startEvt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }> | undefined
      expect(startEvt).toBeDefined()
      expect(events.some((e) => e.type === 'status_change' && e.status === 'streaming')).toBe(true)

      const messageId = startEvt!.message.id
      hoisted.captured.emit?.({ type: 'message_complete', messageId, metadata: {} })
      await sendPromise
    })

    it('send() throws if backend not started', async () => {
      const backend = new ClaudeBackend()
      await expect(backend.send({ content: 'x' })).rejects.toThrow(/not started/)
    })

    it('onQueuedTurnStart transfers the pending resolver so message_complete(queuedMessageId) unblocks send()', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const sendPromise = backend.send({ content: 'turn 2' })
      await new Promise((r) => setTimeout(r, 0))

      const originalStart = events.find(
        (e) => e.type === 'message_start',
      ) as Extract<AgentEvent, { type: 'message_start' }> | undefined
      const originalId = originalStart!.message.id

      const queuedMessageId = 'msg_queued_xyz'
      hoisted.captured.onQueuedTurnStart?.(queuedMessageId)

      hoisted.captured.emit?.({ type: 'message_complete', messageId: queuedMessageId, metadata: {} })

      await expect(sendPromise).resolves.toBeUndefined()
      expect(queuedMessageId).not.toBe(originalId)
    })

    it('message_complete with the original messageId still resolves when no queued turn happened', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const sendPromise = backend.send({ content: 'turn 1' })
      await new Promise((r) => setTimeout(r, 0))

      const startEvt = events.find(
        (e) => e.type === 'message_start',
      ) as Extract<AgentEvent, { type: 'message_start' }> | undefined
      hoisted.captured.emit?.({ type: 'message_complete', messageId: startEvt!.message.id, metadata: {} })

      await expect(sendPromise).resolves.toBeUndefined()
    })
  })

  describe('task-notification wake on a rebuilt runtime', () => {
    /**
     * The idle reaper releases the runtime between turns. A mailbox wake is the
     * first traffic on the replacement runtime, and it opens no turn of its own
     * — `iterateMessages` seeds its turn id from `getCurrentMessageId()`. If the
     * finished turn's id survives the release, the fresh loop treats that closed
     * bubble as the open turn: the wake reply streams into the previous message
     * and no `message_start` / `streaming` is ever emitted.
     */
    it('does not carry the completed turn id into the replacement runtime', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const sendPromise = backend.send({ content: 'turn 1' })
      await new Promise((r) => setTimeout(r, 0))
      const startEvt = events.find(
        (e) => e.type === 'message_start',
      ) as Extract<AgentEvent, { type: 'message_start' }> | undefined
      hoisted.captured.emit?.({ type: 'message_complete', messageId: startEvt!.message.id, metadata: {} })
      await sendPromise
      expect(hoisted.captured.getCurrentMessageId?.()).toBe(startEvt!.message.id)

      hoisted.captured.iterationDone?.resolve()
      await backend.releaseRuntime('idle')

      await backend.injectTaskNotification('mailbox ready')

      expect(hoisted.captured.getCurrentMessageId?.()).toBe('')
    })
  })

  describe('interrupt()', () => {
    it('calls query.interrupt()', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      await backend.interrupt()
      expect(hoisted.captured.mockQueryInterrupt).toHaveBeenCalledOnce()
    })

    it('cancels SDK messages that survived the interrupted turn', async () => {
      hoisted.captured.mockQueryInterrupt.mockResolvedValueOnce({ still_queued: ['queued-1', 'queued-2'] })
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())

      await backend.interrupt()

      expect(hoisted.captured.mockQueryCancelAsyncMessage).toHaveBeenCalledTimes(2)
      expect(hoisted.captured.mockQueryCancelAsyncMessage).toHaveBeenCalledWith('queued-1')
      expect(hoisted.captured.mockQueryCancelAsyncMessage).toHaveBeenCalledWith('queued-2')
    })
  })

  // Regression: a turn interrupted while the CLI is wedged (network stall) never
  // produces a `result`, so the `interrupted` latch stays set forever and
  // iterateMessages swallows every later SDK message — the session looks frozen
  // in the UI while the agent keeps working in the background.
  describe('interrupt that the CLI never settles', () => {
    it('does not hang interrupt() when query.interrupt() never resolves, and rebuilds the wedged runtime', async () => {
      vi.useFakeTimers()
      try {
        hoisted.captured.mockQueryInterrupt.mockImplementationOnce(() => new Promise(() => {}))
        const backend = new ClaudeBackend()
        await backend.start(makeStartOpts())
        hoisted.captured.iterationDone?.resolve()

        const interrupted = backend.interrupt()
        await vi.advanceTimersByTimeAsync(30_000)

        await expect(interrupted).resolves.toBeUndefined()
        expect(hoisted.captured.mockQueryClose).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('synthesises message_interrupted and rebuilds when the acked interrupt yields no terminal event', async () => {
      vi.useFakeTimers()
      try {
        const backend = new ClaudeBackend()
        const events: AgentEvent[] = []
        backend.onEvent((e) => events.push(e))
        await backend.start(makeStartOpts())
        hoisted.captured.iterationDone?.resolve()

        const sendPromise = backend.send({ content: 'hello' })
        await vi.advanceTimersByTimeAsync(0)
        const startEvt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }>

        await backend.interrupt()
        // CLI acked the interrupt but never emits `result`.
        await vi.advanceTimersByTimeAsync(30_000)

        const terminal = events.find(
          (e) => e.type === 'message_interrupted' && e.messageId === startEvt.message.id,
        )
        expect(terminal).toBeDefined()
        expect(hoisted.captured.mockQueryClose).toHaveBeenCalled()
        await expect(sendPromise).resolves.toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps the interrupted latch off once the turn ends normally', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const sendPromise = backend.send({ content: 'hello' })
      await new Promise((r) => setTimeout(r, 0))
      const startEvt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }>

      await backend.interrupt()
      expect(hoisted.captured.getInterrupted?.()).toBe(true)

      hoisted.captured.emit?.({ type: 'message_interrupted', messageId: startEvt.message.id, metadata: {} })
      await sendPromise

      expect(hoisted.captured.getInterrupted?.()).toBe(false)
    })

    it('clears the interrupted latch when a queued send starts a new turn', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())

      await backend.interrupt()
      expect(hoisted.captured.getInterrupted?.()).toBe(true)

      // The renderer still believes the session is streaming, so the next user
      // message arrives as priority=next. It must not inherit the stale latch.
      await backend.send({ content: 'next turn', priority: 'next', clientMessageId: 'cm-1' })

      expect(hoisted.captured.getInterrupted?.()).toBe(false)
    })
  })

  describe('queued send (priority=next)', () => {
    it('holds in pendingQueued while a turn is active and flushes on step boundary', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      const firstSend = backend.send({ content: 'turn 1', clientMessageId: 'user_1' })
      await new Promise((r) => setTimeout(r, 0))

      const bridgePushSpy = vi.spyOn(hoisted.captured.bridge as { push: (...args: unknown[]) => void }, 'push')
      await backend.send({ content: 'queued', clientMessageId: 'user_2', priority: 'next' })

      expect(bridgePushSpy).not.toHaveBeenCalled()

      hoisted.captured.onStepBoundary?.()
      expect(bridgePushSpy).toHaveBeenCalledTimes(1)
      const [, tag] = bridgePushSpy.mock.calls[0]!
      expect(tag).toBe('user_2')

      const startEvt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }> | undefined
      hoisted.captured.emit?.({ type: 'message_complete', messageId: startEvt!.message.id, metadata: {} })
      await firstSend
    })

    it('pushes directly with tag when no turn is active', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      const bridgePushSpy = vi.spyOn(hoisted.captured.bridge as { push: (...args: unknown[]) => void }, 'push')

      await backend.send({ content: 'queued', clientMessageId: 'user_q', priority: 'next' })

      expect(bridgePushSpy).toHaveBeenCalledTimes(1)
      const [, tag] = bridgePushSpy.mock.calls[0]!
      expect(tag).toBe('user_q')
    })

    it('does not emit message_start or status_change for queued sends', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      await backend.send({ content: 'queued', clientMessageId: 'user_q', priority: 'next' })

      expect(events.some((e) => e.type === 'message_start')).toBe(false)
      expect(events.some((e) => e.type === 'status_change')).toBe(false)
    })

    it('dequeueMessage removes a queued send held in pendingQueued before it reaches the bridge', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      const firstSend = backend.send({ content: 'turn 1', clientMessageId: 'user_1' })
      await new Promise((r) => setTimeout(r, 0))

      await backend.send({ content: 'queued', clientMessageId: 'user_2', priority: 'next' })

      const bridgePushSpy = vi.spyOn(hoisted.captured.bridge as { push: (...args: unknown[]) => void }, 'push')
      const removed = backend.dequeueMessage('user_2')
      expect(removed).toBe(true)

      hoisted.captured.onStepBoundary?.()
      expect(bridgePushSpy).not.toHaveBeenCalled()

      hoisted.captured.emit?.({ type: 'message_complete', messageId: 'msg_any' })
      hoisted.captured.iterationDone?.resolve()
      await backend.close().catch(() => {})
      await firstSend.catch(() => {})
    })

    it('emits queued_message_consumed when the bridge iterator consumes a tagged message', async () => {
      const backend = new ClaudeBackend()
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))
      await backend.start(makeStartOpts())

      await backend.send({ content: 'queued', clientMessageId: 'user_q', priority: 'next' })

      const bridge = hoisted.captured.bridge as AsyncIterable<unknown>
      const iterator = bridge[Symbol.asyncIterator]()
      await iterator.next()

      const consumedEvent = events.find((e) => e.type === 'queued_message_consumed') as Extract<AgentEvent, { type: 'queued_message_consumed' }> | undefined
      expect(consumedEvent?.clientMessageId).toBe('user_q')
    })
  })

  describe('prewarm()', () => {
    it('forwards buildClaudeOptions(opts) to warmupManager.prewarm', () => {
      const backend = new ClaudeBackend()
      backend.prewarm({
        sessionId: 'sess-prewarm',
        projectPath: '/tmp/proj',
        cwd: '/tmp/proj',
        config: { apiKey: 'sk-test' },
        permissionMode: 'default',
        effort: 'high',
        model: 'claude-opus',
        abortController: new AbortController(),
      })
      expect(hoisted.captured.buildClaudeOptionsMock).toHaveBeenCalledOnce()
      expect(hoisted.captured.warmupPrewarm).toHaveBeenCalledOnce()
      const builtOpts = hoisted.captured.buildClaudeOptionsMock.mock.calls[0]![0] as {
        cwd: string
        model: string
        effort: string
        env?: Record<string, string>
      }
      expect(builtOpts.cwd).toBe('/tmp/proj')
      expect(builtOpts.model).toBe('claude-opus')
      expect(builtOpts.effort).toBe('high')
      expect(builtOpts.env?.ANTHROPIC_API_KEY).toBe('sk-test')
    })

    it('skips prewarm when active runtime already matches the requested key (no wasted warmup process)', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.warmupPrewarm.mockClear()
      backend.prewarm(makeStartOpts())
      expect(hoisted.captured.warmupPrewarm).not.toHaveBeenCalled()
    })

    it('still forwards prewarm when key changes after start (rebuild-ahead: e.g. model/effort change)', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.warmupPrewarm.mockClear()
      backend.prewarm({ ...makeStartOpts(), model: 'claude-opus' })
      expect(hoisted.captured.warmupPrewarm).toHaveBeenCalledOnce()
    })

    it('start() passes the warmupManager into createSessionQuery', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      expect((opts as { warmupManager?: unknown }).warmupManager).toBeDefined()
    })

    it('close() does NOT dispose the global warmupManager (would clobber other sessions sharing it)', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      hoisted.captured.warmupDispose.mockClear()
      await backend.close()
      expect(hoisted.captured.warmupDispose).not.toHaveBeenCalled()
    })

    it('prewarm() passes a real canUseTool into buildClaudeOptions (not undefined)', () => {
      const backend = new ClaudeBackend()
      backend.prewarm(makeStartOpts())
      const builtOpts = hoisted.captured.buildClaudeOptionsMock.mock.calls[0]![0] as { canUseTool?: unknown; trackPlanFile?: unknown }
      expect(builtOpts.canUseTool).toBeTypeOf('function')
      expect(builtOpts.trackPlanFile).toBeTypeOf('function')
    })

    it('prewarm() then start() reuse the same canUseTool instance (SDK warm process binds to prewarm callback)', async () => {
      const sentinelCanUseTool = vi.fn()
      const sentinelTrackPlanFile = vi.fn()
      permissionHoisted.createCanUseToolMock.mockImplementation(() => ({ canUseTool: sentinelCanUseTool, trackPlanFile: sentinelTrackPlanFile }))
      const backend = new ClaudeBackend()
      backend.prewarm(makeStartOpts())
      const prewarmOpts = hoisted.captured.buildClaudeOptionsMock.mock.calls[0]![0] as { canUseTool?: unknown }
      await backend.start(makeStartOpts())
      const startOpts = hoisted.captured.createSessionQueryMock.mock.calls[0]![1] as { canUseTool?: unknown }
      expect(permissionHoisted.createCanUseToolMock).toHaveBeenCalledTimes(1)
      expect(prewarmOpts.canUseTool).toBe(sentinelCanUseTool)
      expect(startOpts.canUseTool).toBe(sentinelCanUseTool)
    })
  })

  describe('rebuild()', () => {
    it('starts the backend when called before start()', async () => {
      const backend = new ClaudeBackend()
      await backend.rebuild(makeStartOpts())
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledOnce()
    })

    it('closes old query/bridge and re-spawns createSessionQuery with preserved providerSessionId', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.onSessionId?.('sdk-sid-original')

      const firstIterationDone = hoisted.captured.iterationDone!
      firstIterationDone.resolve()

      hoisted.captured.createSessionQueryMock.mockClear()
      await backend.rebuild({ ...makeStartOpts(), effort: 'xhigh' })

      expect(hoisted.captured.mockQueryClose).toHaveBeenCalledOnce()
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledOnce()
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      expect((opts as { resume?: string; effort?: string }).resume).toBe('sdk-sid-original')
      expect((opts as { resume?: string; effort?: string }).effort).toBe('xhigh')
    })

    it('does NOT dispose the warmupManager (slot survives rebuild)', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await backend.rebuild(makeStartOpts())
      expect(hoisted.captured.warmupDispose).not.toHaveBeenCalled()
    })
  })

  describe('rejectAllPending reason tagging', () => {
    it('interrupt() tags rejectAllPending with backend.interrupt', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      permissionHoisted.rejectAllPendingMock.mockClear()
      await backend.interrupt()
      expect(permissionHoisted.rejectAllPendingMock).toHaveBeenCalledWith(expect.any(Map), expect.any(Map), expect.any(Map), expect.any(Map), 'backend.interrupt')
    })

    it('close() tags rejectAllPending with backend.close', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      permissionHoisted.rejectAllPendingMock.mockClear()
      await backend.close()
      expect(permissionHoisted.rejectAllPendingMock).toHaveBeenCalledWith(expect.any(Map), expect.any(Map), expect.any(Map), expect.any(Map), 'backend.close')
    })

    it('rebuild() tags rejectAllPending with backend.rebuild', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      permissionHoisted.rejectAllPendingMock.mockClear()
      await backend.rebuild(makeStartOpts())
      expect(permissionHoisted.rejectAllPendingMock).toHaveBeenCalledWith(expect.any(Map), expect.any(Map), expect.any(Map), expect.any(Map), 'backend.rebuild')
    })
  })

  describe('idle dispose', () => {
    it('reports whether it owns an active runtime', async () => {
      const backend = new ClaudeBackend()
      expect(backend.hasActiveRuntime()).toBe(false)
      await backend.start(makeStartOpts())
      expect(backend.hasActiveRuntime()).toBe(true)
    })

    it('send() lazy-revives runtime after idle release', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(1)

      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')

      expect(backend.hasActiveRuntime()).toBe(false)

      void backend.send({ content: 'hi again' })
      await new Promise((r) => setTimeout(r, 0))

      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
    })

    it('releaseRuntime preserves providerSessionId for resume', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.onSessionId?.('sdk-sid-resume')
      expect(backend.getCurrentProviderSessionId()).toBe('sdk-sid-resume')

      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')

      expect(backend.getCurrentProviderSessionId()).toBe('sdk-sid-resume')

      void backend.send({ content: 'after release' })
      await new Promise((r) => setTimeout(r, 0))

      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
      expect((opts as { resume?: string }).resume).toBe('sdk-sid-resume')
    })

    it('does not release while background tasks are active', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.activeBackgroundTasks!.set('task-1', { toolUseId: 'tu-1', description: 'dev server' })
      await backend.releaseRuntime('idle')
      expect(backend.hasActiveRuntime()).toBe(true)

      hoisted.captured.activeBackgroundTasks!.delete('task-1')
      hoisted.captured.iterationDone?.resolve()
      await backend.releaseRuntime('idle')
      expect(backend.hasActiveRuntime()).toBe(false)
    })

    it('releaseRuntime(rebuild) emits a stopped task_notification for each live background task', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.activeBackgroundTasks!.set('task-1', { toolUseId: 'tu-1', description: 'dev server' })
      hoisted.captured.activeBackgroundTasks!.set('task-2', { toolUseId: 'tu-2', description: 'test watcher' })
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))

      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'rebuild') => Promise<void> }).releaseRuntime('rebuild')

      const notifications = events.filter((e) => e.type === 'task_notification')
      expect(notifications).toHaveLength(2)
      expect(notifications[0]).toMatchObject({ taskId: 'task-1', toolUseId: 'tu-1', taskStatus: 'stopped' })
      expect(notifications[1]).toMatchObject({ taskId: 'task-2', toolUseId: 'tu-2', taskStatus: 'stopped' })
      expect(backend.hasActiveBackgroundTasks()).toBe(false)
    })

    it('releaseRuntime(close) does not emit task notifications for live background tasks', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.activeBackgroundTasks!.set('task-1', { toolUseId: 'tu-1', description: 'dev server' })
      const events: AgentEvent[] = []
      backend.onEvent((e) => events.push(e))

      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'close') => Promise<void> }).releaseRuntime('close')

      expect(events.filter((e) => e.type === 'task_notification')).toHaveLength(0)
    })

    it('does not release while an interaction is pending', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      const pp = (backend as unknown as { pendingPermissions: Map<string, unknown> }).pendingPermissions
      pp.set('req-1', {})
      await backend.releaseRuntime('idle')
      expect(backend.hasActiveRuntime()).toBe(true)
    })

    it('releaseRuntime tags rejectAllPending with backend.idle', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      permissionHoisted.rejectAllPendingMock.mockClear()

      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')

      expect(permissionHoisted.rejectAllPendingMock).toHaveBeenCalledWith(
        expect.any(Map), expect.any(Map), expect.any(Map), expect.any(Map), 'backend.idle',
      )
    })
  })

  describe('idle revival for bypass operations', () => {
    async function startThenIdleRelease(): Promise<ClaudeBackend> {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(1)
      return backend
    }

    it('rewindFiles() revives the runtime after idle release instead of returning No active session', async () => {
      const backend = await startThenIdleRelease()

      const result = await backend.rewindFiles('msg-1')

      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(result.canRewind).toBe(true)
      expect(result.error).toBeUndefined()
      expect(hoisted.captured.mockQueryRewindFiles).toHaveBeenCalledWith('msg-1', undefined)
    })

    it('getContextUsage() revives the runtime after idle release instead of returning null', async () => {
      const backend = await startThenIdleRelease()

      const usage = await backend.getContextUsage()

      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(usage).not.toBeNull()
      expect(usage?.totalTokens).toBe(5)
    })

    it('getMcpServerStatus() revives the runtime after idle release', async () => {
      const backend = await startThenIdleRelease()

      await backend.getMcpServerStatus()

      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(hoisted.captured.mockQueryMcpServerStatus).toHaveBeenCalledOnce()
    })

    it('reconnectMcp() revives the runtime after idle release instead of throwing No active session', async () => {
      const backend = await startThenIdleRelease()

      await expect(backend.reconnectMcp('server-a')).resolves.toBeUndefined()
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(hoisted.captured.mockQueryReconnectMcpServer).toHaveBeenCalledWith('server-a')
    })

    it('toggleMcpServer() revives the runtime after idle release instead of throwing No active session', async () => {
      const backend = await startThenIdleRelease()

      await expect(backend.toggleMcpServer('server-a', false)).resolves.toBeUndefined()
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(hoisted.captured.mockQueryToggleMcpServer).toHaveBeenCalledWith('server-a', false)
    })

    it('reloadPlugins() revives the runtime after idle release instead of returning false', async () => {
      const backend = await startThenIdleRelease()

      await expect(backend.reloadPlugins()).resolves.toBe(true)
      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledTimes(2)
      expect(hoisted.captured.mockQueryReloadPlugins).toHaveBeenCalledOnce()
    })
  })

  describe('setter write-through survives idle release', () => {
    async function startThenIdleRelease(): Promise<ClaudeBackend> {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')
      return backend
    }

    it('setPermissionMode while idle-released applies the new mode to the revived runtime', async () => {
      const backend = await startThenIdleRelease()

      await backend.setPermissionMode('plan')
      void backend.send({ content: 'hi' })
      await new Promise((r) => setTimeout(r, 0))

      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
      expect((opts as { permissionMode?: string }).permissionMode).toBe('plan')
    })

    it('setSandbox while idle-released applies the new sandbox to the revived runtime', async () => {
      const backend = await startThenIdleRelease()

      await backend.setSandbox({ enabled: true, autoAllowBash: false })
      void backend.send({ content: 'hi' })
      await new Promise((r) => setTimeout(r, 0))

      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
      expect((opts as { sandboxInfo?: unknown }).sandboxInfo).toEqual({ enabled: true, autoAllowBash: false })
    })

    it('setModel while idle-released applies the new model to the revived runtime', async () => {
      const backend = await startThenIdleRelease()

      await backend.setModel('claude-opus-4-8')
      void backend.send({ content: 'hi' })
      await new Promise((r) => setTimeout(r, 0))

      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[1]!
      expect((opts as { model?: string }).model).toBe('claude-opus-4-8')
    })
  })

  describe('subprocess cleanup on release (SIGTERM via spawn-AbortController)', () => {
    it('aborts the spawn-time AbortController on close so spawn({ signal }) delivers SIGTERM — cold-start path', async () => {
      const backend = new ClaudeBackend()
      const opts = makeStartOpts()
      await backend.start(opts)
      expect(opts.abortController.signal.aborted).toBe(false)
      hoisted.captured.iterationDone?.resolve()
      await backend.close()
      expect(opts.abortController.signal.aborted).toBe(true)
    })

    it('aborts the spawn-time AbortController on idle release too (not only close)', async () => {
      const backend = new ClaudeBackend()
      const opts = makeStartOpts()
      await backend.start(opts)
      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')
      expect(opts.abortController.signal.aborted).toBe(true)
    })

    it('aborts the WARMUP-time AbortController (not opts.abortController) when consume returned a slot', async () => {
      const warmupAC = new AbortController()
      hoisted.captured.createSessionQueryMock.mockImplementationOnce(
        (bridge: unknown, _opts: unknown, emit: (e: AgentEvent) => void, _gMid: () => string, _gTs: () => number, _gI: () => boolean, onSid: (id: string) => void, onQTS: (id: string) => void, onSB: () => void) => {
          hoisted.captured.emit = emit
          hoisted.captured.onSessionId = onSid
          hoisted.captured.onQueuedTurnStart = onQTS
          hoisted.captured.onStepBoundary = onSB
          hoisted.captured.bridge = bridge
          let resolveIter: () => void = () => {}
          const promise = new Promise<void>((r) => { resolveIter = r })
          hoisted.captured.iterationDone = { resolve: resolveIter, promise }
          return {
            query: {
              interrupt: hoisted.captured.mockQueryInterrupt,
              close: hoisted.captured.mockQueryClose,
              setModel: hoisted.captured.mockQuerySetModel,
              rewindFiles: hoisted.captured.mockQueryRewindFiles,
              getContextUsage: hoisted.captured.mockQueryGetContextUsage,
              mcpServerStatus: hoisted.captured.mockQueryMcpServerStatus,
              reconnectMcpServer: hoisted.captured.mockQueryReconnectMcpServer,
              toggleMcpServer: hoisted.captured.mockQueryToggleMcpServer,
              reloadPlugins: hoisted.captured.mockQueryReloadPlugins,
            },
            iterationDone: promise,
            spawnAbortController: warmupAC,
          }
        }
      )
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await backend.close()
      expect(warmupAC.signal.aborted).toBe(true)
    })

    it('uses a fresh AbortController when ensureRuntime respawns after release (no reuse of aborted AC)', async () => {
      const backend = new ClaudeBackend()
      const opts = makeStartOpts()
      await backend.start(opts)
      hoisted.captured.iterationDone?.resolve()
      await (backend as unknown as { releaseRuntime: (r: 'idle') => Promise<void> }).releaseRuntime('idle')

      opts.abortController.abort()

      hoisted.captured.createSessionQueryMock.mockClear()
      void backend.send({ content: 'after release' })
      await new Promise((r) => setTimeout(r, 0))

      expect(hoisted.captured.createSessionQueryMock).toHaveBeenCalledOnce()
      const [, secondOpts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      const respawnAC = (secondOpts as { abortController?: AbortController }).abortController
      expect(respawnAC).toBeInstanceOf(AbortController)
      expect(respawnAC?.signal.aborted).toBe(false)
    })
  })
})
