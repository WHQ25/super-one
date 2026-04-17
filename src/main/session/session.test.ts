import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '../../shared/agent-types'
import type { BackendStartOptions, SessionBackend, SessionStateChange } from './types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { Session, type SessionConstructorOptions } from './session'

class FakeBackend implements SessionBackend {
  readonly kind = 'claude' as const

  started = false
  disposed = false
  startOpts: BackendStartOptions | null = null
  sendCalls: SendMessageRequest[] = []
  interruptCalls = 0
  startShouldFail: Error | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  resolveSend: (() => void) | null = null
  resolveInterrupt: (() => void) | null = null

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.startShouldFail) throw this.startShouldFail
    this.started = true
    this.startOpts = opts
  }

  async send(request: SendMessageRequest): Promise<void> {
    this.sendCalls.push(request)
    await new Promise<void>((resolve) => { this.resolveSend = resolve })
  }

  async interrupt(): Promise<void> {
    this.interruptCalls++
    await new Promise<void>((resolve) => { this.resolveInterrupt = resolve })
  }

  async close(): Promise<void> {
    this.disposed = true
  }

  async setModel(_model: string): Promise<void> {}
  async setPermissionMode(_mode: import('../../shared/agent-types').PermissionMode): Promise<void> {}
  respondToPermission(): void {}
  respondToQuestion(): void {}
  dismissQuestion(): void {}
  respondToPlanApproval(): void {}
  async getContextUsage() { return null }
  async getMcpServerStatus() { return [] }
  async rewindFiles() { return { canRewind: false } }
  async reconnectMcp(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async reloadPlugins(): Promise<boolean> { return false }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => { this.providerSessionIdListeners.delete(handler) }
  }

  emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) cb(event)
  }

  fireProviderSessionId(id: string): void {
    for (const cb of this.providerSessionIdListeners) cb(id)
  }
}

function makeSession(overrides: Partial<SessionConstructorOptions> = {}): { session: Session; backend: FakeBackend } {
  const backend = new FakeBackend()
  const session = new Session({
    id: 'sess-1',
    projectPath: '/tmp/proj',
    cwd: '/tmp/proj',
    providerId: 'claude-base',
    harnessId: 'claude',
    providerConfig: { apiKey: 'sk-x' },
    backend,
    ...overrides,
  })
  return { session, backend }
}

describe('Session state machine', () => {
  let session: Session
  let backend: FakeBackend

  beforeEach(() => {
    ({ session, backend } = makeSession())
  })

  it('starts in idle status', () => {
    expect(session.snapshot.status).toBe('idle')
  })

  it('send() transitions idle → starting → streaming → ended', async () => {
    const states: string[] = []
    states.push(session.snapshot.status)

    const sendPromise = session.send({ content: 'hi' })
    await new Promise((r) => setTimeout(r, 0))
    states.push(session.snapshot.status)
    expect(backend.started).toBe(true)
    expect(backend.sendCalls).toHaveLength(1)

    backend.resolveSend?.()
    await sendPromise
    states.push(session.snapshot.status)

    expect(states).toEqual(['idle', 'streaming', 'ended'])
  })

  it('second send() reuses the started backend (no re-start)', async () => {
    const first = session.send({ content: 'a' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await first

    backend.started = false
    const second = session.send({ content: 'b' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.started).toBe(false)
    expect(backend.sendCalls).toHaveLength(2)

    backend.resolveSend?.()
    await second
  })

  it('interrupt() during streaming transitions streaming → interrupting → ended', async () => {
    const sendPromise = session.send({ content: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    expect(session.snapshot.status).toBe('streaming')

    const interruptPromise = session.interrupt()
    await new Promise((r) => setTimeout(r, 0))
    expect(session.snapshot.status).toBe('interrupting')

    backend.resolveInterrupt?.()
    backend.resolveSend?.()
    await Promise.all([sendPromise, interruptPromise])
    expect(session.snapshot.status).toBe('ended')
    expect(backend.interruptCalls).toBe(1)
  })

  it('interrupt() while idle is a no-op', async () => {
    await session.interrupt()
    expect(session.snapshot.status).toBe('idle')
    expect(backend.interruptCalls).toBe(0)
  })

  it('dispose() transitions to disposed and closes backend', async () => {
    const sendPromise = session.send({ content: 'x' })
    await new Promise((r) => setTimeout(r, 0))

    backend.resolveSend?.()
    await sendPromise

    await session.dispose()
    expect(session.snapshot.status).toBe('disposed')
    expect(backend.disposed).toBe(true)
  })

  it('send() after dispose throws', async () => {
    await session.dispose()
    await expect(session.send({ content: 'x' })).rejects.toThrow(/disposed/)
  })

  it('failed backend.start() rolls status back to idle', async () => {
    backend.startShouldFail = new Error('spawn failed')
    await expect(session.send({ content: 'x' })).rejects.toThrow('spawn failed')
    expect(session.snapshot.status).toBe('idle')
  })
})

describe('Session event forwarding', () => {
  it('forwards backend events with sessionId tagged', async () => {
    const { session, backend } = makeSession()
    const received: AgentEvent[] = []
    session.on((e) => received.push(e))

    backend.emit({ type: 'status_change', status: 'streaming' })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'status_change', status: 'streaming', sessionId: 'sess-1' })
  })

  it('unsubscribe stops delivery', async () => {
    const { session, backend } = makeSession()
    const received: AgentEvent[] = []
    const unsub = session.on((e) => received.push(e))
    unsub()
    backend.emit({ type: 'status_change', status: 'idle' })
    expect(received).toHaveLength(0)
  })

  it('tracks currentMessageId from message_start / clears on message_complete', async () => {
    const { session, backend } = makeSession()
    backend.emit({
      type: 'message_start',
      message: { id: 'msg-99', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    expect(session.snapshot.currentMessageId).toBe('msg-99')
    backend.emit({ type: 'message_complete', messageId: 'msg-99', metadata: {} })
    expect(session.snapshot.currentMessageId).toBeNull()
  })

  it('captures providerSessionId from backend', async () => {
    const { session, backend } = makeSession()
    expect(session.snapshot.providerSessionId).toBeNull()
    backend.fireProviderSessionId('sdk-xyz')
    expect(session.snapshot.providerSessionId).toBe('sdk-xyz')
  })
})

describe('Session - passes provider config into backend.start', () => {
  it('includes cwd, config, permissionMode, resumedProviderSessionId', async () => {
    const { session, backend } = makeSession({
      cwd: '/tmp/worktree',
      providerConfig: { apiKey: 'sk-abc', model: 'claude-opus-4-7' },
      permissionMode: 'acceptEdits',
      resumedProviderSessionId: 'prior-thread',
    })
    const promise = session.send({ content: 'hello' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.startOpts).toMatchObject({
      cwd: '/tmp/worktree',
      config: { apiKey: 'sk-abc', model: 'claude-opus-4-7' },
      permissionMode: 'acceptEdits',
      providerSessionId: 'prior-thread',
    })
    backend.resolveSend?.()
    await promise
  })
})

describe('Session message accumulation', () => {
  it('appends a user message to snapshot on send()', async () => {
    const { session, backend } = makeSession()
    const promise = session.send({ content: 'hello world', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(session.snapshot.messages).toHaveLength(1)
    expect(session.snapshot.messages[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      content: [{ type: 'text', text: 'hello world' }],
    })

    backend.resolveSend?.()
    await promise
  })

  it('accepts initialMessages on construction (for resume)', () => {
    const initial: ChatMessage[] = [
      { id: 'u0', role: 'user', status: 'complete', content: [{ type: 'text', text: 'older' }], createdAt: '2025-01-01', providerId: 'local' },
      { id: 'a0', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'older reply' }], createdAt: '2025-01-02', providerId: 'claude' },
    ]
    const { session } = makeSession({
      initialMessages: initial,
      initialTotalCostUsd: 0.42,
      initialContextTokens: 1234,
    })
    expect(session.snapshot.messages).toEqual(initial)
    expect(session.snapshot.totalCostUsd).toBe(0.42)
    expect(session.snapshot.contextTokens).toBe(1234)
  })

  it('accumulates content_delta into the streaming assistant message (claude)', () => {
    const { session, backend } = makeSession()
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'Hello' } })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: ' world' } })

    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    expect(msg?.content).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('updates totalCostUsd and contextTokens from message_complete metadata', () => {
    const { session, backend } = makeSession()
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({
      type: 'message_complete',
      messageId: 'a1',
      metadata: {
        costUsd: 0.017,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 30,
        },
      },
    })
    expect(session.snapshot.totalCostUsd).toBe(0.017)
    expect(session.snapshot.contextTokens).toBe(330)
    expect(session.snapshot.messages.find((m) => m.id === 'a1')?.status).toBe('complete')
  })

  it('dispatches codex events through codex reducer when harnessId=codex', () => {
    const { session, backend } = makeSession({
      harnessId: 'codex',
      initialMessages: [
        { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
      ],
    })
    backend.emit({
      type: 'codex_thread_started',
      messageId: 'a1',
      threadId: 'thread-abc',
      projectPath: '/tmp/proj',
      sessionId: 'sess-1',
    })
    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    expect(msg?.metadata?.codex?.threadId).toBe('thread-abc')
  })
})

describe('Session persist hook', () => {
  it('fires onStateChange on user message append', async () => {
    const calls: SessionStateChange[] = []
    const { session, backend } = makeSession({
      onStateChange: (s) => calls.push(s),
    })
    const promise = session.send({ content: 'first', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(calls.length).toBeGreaterThanOrEqual(1)
    const first = calls[0]
    expect(first.sid).toBe('sess-1')
    expect(first.messages.some((m) => m.id === 'u1')).toBe(true)
    expect(first.title).toBe('first')

    backend.resolveSend?.()
    await promise
  })

  it('fires onStateChange on message_complete with accumulated cost', async () => {
    const calls: SessionStateChange[] = []
    const { session, backend } = makeSession({ onStateChange: (s) => calls.push(s) })
    const promise = session.send({ content: 'hi', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    calls.length = 0

    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({
      type: 'message_complete',
      messageId: 'a1',
      metadata: { costUsd: 0.05, usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
    })

    const last = calls[calls.length - 1]
    expect(last).toBeDefined()
    expect(last.totalCostUsd).toBe(0.05)
    expect(last.contextTokens).toBe(10)
    expect(last.messages.find((m) => m.id === 'a1')?.status).toBe('complete')

    backend.resolveSend?.()
    await promise
  })

  it('fires onStateChange on message_interrupted and message_error', () => {
    const calls: SessionStateChange[] = []
    const { session, backend } = makeSession({
      onStateChange: (s) => calls.push(s),
      initialMessages: [
        { id: 'u0', role: 'user', status: 'complete', content: [{ type: 'text', text: 'seed' }], createdAt: '', providerId: 'local' },
      ],
    })
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    const preCount = calls.length
    backend.emit({ type: 'message_interrupted', messageId: 'a1' })
    expect(calls.length).toBe(preCount + 1)
    expect(session.snapshot.messages.find((m) => m.id === 'a1')?.status).toBe('interrupted')

    backend.emit({
      type: 'message_start',
      message: { id: 'a2', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    const preCount2 = calls.length
    backend.emit({ type: 'message_error', messageId: 'a2', error: 'boom' })
    expect(calls.length).toBe(preCount2 + 1)
    expect(session.snapshot.messages.find((m) => m.id === 'a2')?.status).toBe('error')
  })

  it('does not fire onStateChange when accumulated message list is empty', () => {
    const calls: SessionStateChange[] = []
    const { backend } = makeSession({ onStateChange: (s) => calls.push(s) })
    // message_complete referring to a message that was never started: reducer
    // leaves messages empty, so nothing to persist.
    backend.emit({ type: 'message_complete', messageId: 'ghost', metadata: {} })
    expect(calls).toHaveLength(0)
  })
})
