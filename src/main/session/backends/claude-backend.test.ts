import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '../../../shared/agent-types'

const hoisted = vi.hoisted(() => {
  interface Captured {
    emit: ((e: AgentEvent) => void) | null
    onSessionId: ((id: string) => void) | null
    onQueuedTurnStart: ((messageId: string) => void) | null
    bridge: unknown
    iterationDone: { resolve: () => void; promise: Promise<void> } | null
    createSessionQueryMock: ReturnType<typeof vi.fn>
    buildClaudeOptionsMock: ReturnType<typeof vi.fn>
    warmupPrewarm: ReturnType<typeof vi.fn>
    warmupDispose: ReturnType<typeof vi.fn>
    mockQueryInterrupt: ReturnType<typeof vi.fn>
    mockQueryClose: ReturnType<typeof vi.fn>
    mockQuerySetModel: ReturnType<typeof vi.fn>
  }
  const captured: Captured = {
    emit: null,
    onSessionId: null,
    onQueuedTurnStart: null,
    bridge: null,
    iterationDone: null,
    createSessionQueryMock: vi.fn(),
    buildClaudeOptionsMock: vi.fn((opts: unknown) => ({ __built: opts })),
    warmupPrewarm: vi.fn(),
    warmupDispose: vi.fn(),
    mockQueryInterrupt: vi.fn(async () => {}),
    mockQueryClose: vi.fn(),
    mockQuerySetModel: vi.fn(async () => {}),
  }
  captured.createSessionQueryMock.mockImplementation(
    (bridge: unknown, _opts: unknown, emit: (e: AgentEvent) => void, _getMid: () => string, _getTs: () => number, _getInterrupted: () => boolean, onSessionId: (id: string) => void, onQueuedTurnStart: (id: string) => void) => {
      captured.emit = emit
      captured.onSessionId = onSessionId
      captured.onQueuedTurnStart = onQueuedTurnStart
      captured.bridge = bridge
      let resolveIter: () => void = () => {}
      const promise = new Promise<void>((resolve) => { resolveIter = resolve })
      captured.iterationDone = { resolve: resolveIter, promise }
      return {
        query: {
          interrupt: captured.mockQueryInterrupt,
          close: captured.mockQueryClose,
          setModel: captured.mockQuerySetModel,
        },
        iterationDone: promise,
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

vi.mock('../../agent/warmup-manager', () => ({
  WarmupManager: class {
    prewarm = hoisted.captured.warmupPrewarm
    consume = () => null
    dispose = hoisted.captured.warmupDispose
  },
  getSharedWarmupManager: () => ({
    prewarm: hoisted.captured.warmupPrewarm,
    consume: () => null,
    dispose: hoisted.captured.warmupDispose,
  }),
}))

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../agent/claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: vi.fn(),
}))

import { ClaudeBackend } from './claude-backend'

function makeStartOpts() {
  return {
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
    hoisted.captured.bridge = null
    hoisted.captured.iterationDone = null
    hoisted.captured.createSessionQueryMock.mockClear()
    hoisted.captured.buildClaudeOptionsMock.mockClear()
    hoisted.captured.warmupPrewarm.mockClear()
    hoisted.captured.warmupDispose.mockClear()
    hoisted.captured.mockQueryInterrupt.mockClear()
    hoisted.captured.mockQueryClose.mockClear()
    hoisted.captured.mockQuerySetModel.mockClear()
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
      expect((opts as { env?: Record<string, string> }).env).toMatchObject({
        ANTHROPIC_API_KEY: 'sk-abc',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        CUSTOM_VAR: 'x',
      })
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

  describe('interrupt()', () => {
    it('calls query.interrupt()', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      await backend.interrupt()
      expect(hoisted.captured.mockQueryInterrupt).toHaveBeenCalledOnce()
    })
  })

  describe('prewarm()', () => {
    it('forwards buildClaudeOptions(opts) to warmupManager.prewarm', () => {
      const backend = new ClaudeBackend()
      backend.prewarm({
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

    it('still forwards prewarm after backend has started (for rebuild-ahead scenarios)', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.warmupPrewarm.mockClear()
      backend.prewarm(makeStartOpts())
      expect(hoisted.captured.warmupPrewarm).toHaveBeenCalledOnce()
    })

    it('start() passes the warmupManager into createSessionQuery', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      const [, opts] = hoisted.captured.createSessionQueryMock.mock.calls[0]!
      expect((opts as { warmupManager?: unknown }).warmupManager).toBeDefined()
    })

    it('close() does NOT dispose the shared warmupManager', async () => {
      const backend = new ClaudeBackend()
      await backend.start(makeStartOpts())
      hoisted.captured.iterationDone?.resolve()
      await backend.close()
      expect(hoisted.captured.warmupDispose).not.toHaveBeenCalled()
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
})
