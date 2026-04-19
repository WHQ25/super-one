import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '../../shared/agent-types'
import type { BackendStartOptions, SessionBackend, SessionStateChange } from './types'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

const traceMock = vi.fn()
vi.mock('../agent/event-trace', () => ({
  trace: (...args: unknown[]) => traceMock(...args),
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

  prewarmCalls: BackendStartOptions[] = []
  prewarm(opts: BackendStartOptions): void {
    this.prewarmCalls.push(opts)
  }

  rebuildCalls: BackendStartOptions[] = []
  async rebuild(opts: BackendStartOptions): Promise<void> {
    this.rebuildCalls.push(opts)
    this.startOpts = opts
  }

  dequeueMessage(_clientMessageId: string): boolean { return false }
  getPendingInteractions(): AgentEvent[] { return [] }

  commandCalls: import('./types').BackendCommand[] = []
  async handleCommand(cmd: import('./types').BackendCommand): Promise<void> {
    this.commandCalls.push(cmd)
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
  setPermissionModeCalls: import('../../shared/agent-types').PermissionMode[] = []
  async setPermissionMode(mode: import('../../shared/agent-types').PermissionMode): Promise<void> {
    this.setPermissionModeCalls.push(mode)
  }
  setSandboxCalls: import('../../shared/agent-types').SandboxInfo[] = []
  async setSandbox(info: import('../../shared/agent-types').SandboxInfo): Promise<void> {
    this.setSandboxCalls.push(info)
  }
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

  it('second send() serializes behind the first and does not throw when status=streaming', async () => {
    const p1 = session.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    expect(session.snapshot.status).toBe('streaming')
    expect(backend.sendCalls).toHaveLength(1)

    const p2 = session.send({ content: 'second' })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.sendCalls).toHaveLength(1)

    backend.resolveSend?.()
    await p1

    await new Promise((r) => setTimeout(r, 0))
    expect(backend.sendCalls).toHaveLength(2)
    expect(backend.sendCalls[1]?.content).toBe('second')

    backend.resolveSend?.()
    await p2
    expect(session.snapshot.status).toBe('ended')
  })

  it('send() chain recovers when a prior send rejects', async () => {
    backend.startShouldFail = new Error('spawn failed')
    await expect(session.send({ content: 'will fail' })).rejects.toThrow('spawn failed')

    backend.startShouldFail = null
    const p = session.send({ content: 'after failure' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.sendCalls).toHaveLength(1)
    backend.resolveSend?.()
    await p
  })

  it('prewarm forwards to backend with session cwd, permissionMode, and model', () => {
    ;({ session, backend } = makeSession({ model: 'claude-opus-4-7', permissionMode: 'acceptEdits' }))
    session.prewarm()
    expect(backend.prewarmCalls).toHaveLength(1)
    expect(backend.prewarmCalls[0]).toMatchObject({
      cwd: '/tmp/proj',
      permissionMode: 'acceptEdits',
      model: 'claude-opus-4-7',
    })
  })

  it('prewarm overrides effort/model/additionalDirs when hint is provided', () => {
    ;({ session, backend } = makeSession({ model: 'baseline', effort: 'low' }))
    session.prewarm({ effort: 'high', model: 'override', additionalDirs: ['/extra'] })
    expect(backend.prewarmCalls[0]).toMatchObject({
      effort: 'high',
      model: 'override',
      additionalDirectories: ['/extra'],
    })
  })

  it('send() syncs request.effort/model/additionalDirs into session state (so warmup key matches)', async () => {
    const p = session.send({
      content: 'hi',
      effort: 'xhigh',
      model: 'claude-opus-4-7',
      additionalDirs: ['/extra/dir'],
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.startOpts).toMatchObject({
      effort: 'xhigh',
      model: 'claude-opus-4-7',
      additionalDirectories: ['/extra/dir'],
    })
    backend.resolveSend?.()
    await p
  })

  it('prewarm is NOT skipped after backend has started (so later rebuilds can consume the new warmup slot)', async () => {
    const p = session.send({ content: 'start the backend' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p

    backend.prewarmCalls = []
    session.prewarm({ effort: 'xhigh' })
    expect(backend.prewarmCalls).toHaveLength(1)
    expect(backend.prewarmCalls[0]).toMatchObject({ effort: 'xhigh' })
  })

  it('send() with changed effort triggers backend.rebuild (not re-start)', async () => {
    const p1 = session.send({ content: 'first', effort: 'low' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    expect(backend.rebuildCalls).toHaveLength(0)

    const p2 = session.send({ content: 'second', effort: 'xhigh' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0]).toMatchObject({ effort: 'xhigh' })
    backend.resolveSend?.()
    await p2
  })

  it('send() with changed additionalDirs triggers backend.rebuild', async () => {
    const p1 = session.send({ content: 'first', additionalDirs: ['/a'] })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    const p2 = session.send({ content: 'second', additionalDirs: ['/a', '/b'] })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0]).toMatchObject({ additionalDirectories: ['/a', '/b'] })
    backend.resolveSend?.()
    await p2
  })

  it('send() with unchanged effort/dirs does NOT trigger rebuild', async () => {
    const p1 = session.send({ content: 'first', effort: 'medium' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    const p2 = session.send({ content: 'second', effort: 'medium' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(0)
    backend.resolveSend?.()
    await p2
  })

  describe('setPermissionMode bypass boundary', () => {
    async function bootAndIdle(s: Session, b: FakeBackend) {
      const p = s.send({ content: 'boot', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      b.resolveSend?.()
      await p
    }

    it('idle → bypass: rebuilds backend immediately, does not call backend.setPermissionMode', async () => {
      await bootAndIdle(session, backend)
      expect(backend.rebuildCalls).toHaveLength(0)

      await session.setPermissionMode('bypassPermissions')

      expect(backend.rebuildCalls).toHaveLength(1)
      expect(backend.rebuildCalls[0].permissionMode).toBe('bypassPermissions')
      expect(backend.setPermissionModeCalls).toHaveLength(0)
    })

    it('bypass → default: rebuilds backend immediately (symmetric case)', async () => {
      ;({ session, backend } = makeSession({ permissionMode: 'bypassPermissions' }))
      await bootAndIdle(session, backend)
      expect(backend.rebuildCalls).toHaveLength(0)

      await session.setPermissionMode('default')

      expect(backend.rebuildCalls).toHaveLength(1)
      expect(backend.rebuildCalls[0].permissionMode).toBe('default')
      expect(backend.setPermissionModeCalls).toHaveLength(0)
    })

    it('streaming + bypass switch: defers rebuild to next send', async () => {
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      expect(session.snapshot.status).toBe('streaming')

      await session.setPermissionMode('bypassPermissions')
      expect(backend.rebuildCalls).toHaveLength(0)
      expect(backend.setPermissionModeCalls).toHaveLength(0)
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(true)

      backend.resolveSend?.()
      await pending

      const p2 = session.send({ content: 'after', clientMessageId: 'u1' })
      await new Promise((r) => setTimeout(r, 0))
      expect(backend.rebuildCalls).toHaveLength(1)
      expect(backend.rebuildCalls[0].permissionMode).toBe('bypassPermissions')
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(false)
      backend.resolveSend?.()
      await p2
    })

    it('default → acceptEdits: fast path, calls backend.setPermissionMode, no rebuild', async () => {
      await bootAndIdle(session, backend)

      await session.setPermissionMode('acceptEdits')

      expect(backend.setPermissionModeCalls).toEqual(['acceptEdits'])
      expect(backend.rebuildCalls).toHaveLength(0)
    })

    it('repeated same mode: no backend call at all', async () => {
      ;({ session, backend } = makeSession({ permissionMode: 'plan' }))
      await bootAndIdle(session, backend)

      await session.setPermissionMode('plan')
      await session.setPermissionMode('plan')

      expect(backend.setPermissionModeCalls).toHaveLength(0)
      expect(backend.rebuildCalls).toHaveLength(0)
    })
  })

  describe('setSandboxMode', () => {
    async function bootAndIdle(s: Session, b: FakeBackend) {
      const p = s.send({ content: 'boot', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      b.resolveSend?.()
      await p
    }

    it('after backend started, propagates sandbox change to backend', async () => {
      await bootAndIdle(session, backend)
      expect(backend.setSandboxCalls).toHaveLength(0)

      const updated = await session.setSandboxMode('off')

      expect(updated).toEqual({ enabled: false, autoAllowBash: false })
      expect(backend.setSandboxCalls).toEqual([{ enabled: false, autoAllowBash: false }])
      expect(session.getCurrentSandboxInfo()).toEqual({ enabled: false, autoAllowBash: false })
    })

    it('before backend started, only updates local state', async () => {
      const updated = await session.setSandboxMode('off')

      expect(updated).toEqual({ enabled: false, autoAllowBash: false })
      expect(backend.setSandboxCalls).toHaveLength(0)
      expect(backend.started).toBe(false)
    })

    it('repeated same mode: no backend call', async () => {
      await bootAndIdle(session, backend)

      await session.setSandboxMode('on')
      await session.setSandboxMode('on')

      expect(backend.setSandboxCalls).toHaveLength(0)
    })

    it('auto mode passes autoAllowBash=true to backend', async () => {
      await bootAndIdle(session, backend)

      await session.setSandboxMode('auto')

      expect(backend.setSandboxCalls).toEqual([{ enabled: true, autoAllowBash: true }])
    })
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

  it('traces every emitted event via agent.emit with currentMessageId fallback', () => {
    const { session, backend } = makeSession()
    traceMock.mockClear()
    backend.emit({
      type: 'message_start',
      message: { id: 'msg-42', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({ type: 'content_delta', messageId: 'msg-42', delta: { type: 'text', text: 'hi' } })
    backend.emit({ type: 'status_change', status: 'streaming' })

    expect(traceMock).toHaveBeenCalledTimes(3)
    const first = traceMock.mock.calls[0]
    expect(first[0]).toBe('agent.emit')
    expect(first[1]).toBe('message_start')
    expect(first[2]).toMatchObject({ type: 'message_start', sessionId: session.id })

    const statusCall = traceMock.mock.calls[2]
    expect(statusCall[1]).toBe('status_change')
    expect(statusCall[3]).toBe('msg-42')
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

  it('codex message_start appends the assistant placeholder to _messages', () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    expect(session.snapshot.messages).toHaveLength(0)
    backend.emit({
      type: 'message_start',
      message: { id: 'codex_msg_1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
    })
    expect(session.snapshot.messages.find((m) => m.id === 'codex_msg_1')).toBeDefined()
    expect(session.snapshot.currentMessageId).toBe('codex_msg_1')
  })

  it('codex message_complete finalizes the assistant message content from metadata.codex', () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    backend.emit({
      type: 'message_start',
      message: { id: 'codex_m2', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
    })
    backend.emit({
      type: 'message_complete',
      messageId: 'codex_m2',
      metadata: {
        codex: {
          finalResponse: 'all done',
          durationMs: 42,
          items: [],
          threadId: 'thread-42',
          usage: null,
        },
      } as unknown as Record<string, unknown>,
    })
    const finished = session.snapshot.messages.find((m) => m.id === 'codex_m2')
    expect(finished?.status).toBe('complete')
    expect(finished?.content).toEqual([{ type: 'text', text: 'all done' }])
  })

  it('codex message_interrupted finalizes the assistant message with interrupted status', () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    backend.emit({
      type: 'message_start',
      message: { id: 'codex_m3', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
    })
    backend.emit({ type: 'message_interrupted', messageId: 'codex_m3' })
    const finished = session.snapshot.messages.find((m) => m.id === 'codex_m3')
    expect(finished?.status).toBe('interrupted')
    expect(finished?.content[0]).toMatchObject({ type: 'text', text: 'Codex run interrupted.' })
  })

  it('dispatchBackendCommand(codex.plan_approval) writes metadata.codex.planApproval and emits codex_plan_approval', async () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    backend.emit({
      type: 'message_start',
      message: { id: 'codex_plan_1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
    })
    backend.emit({
      type: 'message_complete',
      messageId: 'codex_plan_1',
      metadata: {
        codex: {
          finalResponse: 'please approve',
          durationMs: 10,
          items: [],
          threadId: 'thread-plan',
          usage: null,
        },
      } as unknown as Record<string, unknown>,
    })
    const captured: AgentEvent[] = []
    session.on((e) => captured.push(e))

    await session.dispatchBackendCommand({ kind: 'codex.plan_approval', messageId: 'codex_plan_1', status: 'approved', feedback: 'LGTM' })

    const msg = session.snapshot.messages.find((m) => m.id === 'codex_plan_1')
    expect(msg?.metadata?.codex?.planApproval).toEqual({ status: 'approved', feedback: 'LGTM' })

    const approvalEvt = captured.find((e) => e.type === 'codex_plan_approval') as Extract<AgentEvent, { type: 'codex_plan_approval' }> | undefined
    expect(approvalEvt?.messageId).toBe('codex_plan_1')
    expect(approvalEvt?.status).toBe('approved')
    expect(approvalEvt?.feedback).toBe('LGTM')
    expect(approvalEvt?.sessionId).toBe('sess-1')
    expect(approvalEvt?.projectPath).toBe('/tmp/proj')
  })

  it('dispatchBackendCommand(codex.collaboration_mode_change) emits codex_collaboration_mode_change', async () => {
    const { session } = makeSession({ harnessId: 'codex' })
    const captured: AgentEvent[] = []
    session.on((e) => captured.push(e))

    await session.dispatchBackendCommand({ kind: 'codex.collaboration_mode_change', mode: 'parallel' })

    const modeEvt = captured.find((e) => e.type === 'codex_collaboration_mode_change') as Extract<AgentEvent, { type: 'codex_collaboration_mode_change' }> | undefined
    expect(modeEvt?.mode).toBe('parallel')
    expect(modeEvt?.sessionId).toBe('sess-1')
    expect(modeEvt?.projectPath).toBe('/tmp/proj')
  })

  it('dispatchBackendCommand(codex.steer) appends user message and forwards to backend.handleCommand', async () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    await session.dispatchBackendCommand({
      kind: 'codex.steer',
      input: 'keep going',
      newUserMessageId: 'user-steer-1',
      newUserText: 'keep going',
      newAssistantMessageId: 'asst-steer-1',
    })
    const userMsg = session.snapshot.messages.find((m) => m.id === 'user-steer-1')
    expect(userMsg?.role).toBe('user')
    expect(userMsg?.content).toEqual([{ type: 'text', text: 'keep going' }])
    expect(backend.commandCalls[0]).toMatchObject({ kind: 'codex.steer', input: 'keep going', newUserMessageId: 'user-steer-1' })
  })

  it('dispatchBackendCommand(codex.steer) without user info skips append but still forwards', async () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    await session.dispatchBackendCommand({ kind: 'codex.steer', input: 'raw' })
    expect(session.snapshot.messages).toHaveLength(0)
    expect(backend.commandCalls[0]).toEqual({ kind: 'codex.steer', input: 'raw' })
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

  it('switchCwd rebuilds backend with new cwd when session is idle', async () => {
    const { session, backend } = makeSession()
    const p0 = session.send({ content: 'hi', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p0
    expect(session.cwd).toBe('/tmp/proj')

    await session.switchCwd('/tmp/proj/.worktrees/abc')

    expect(session.cwd).toBe('/tmp/proj/.worktrees/abc')
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0].cwd).toBe('/tmp/proj/.worktrees/abc')
  })

  it('switchCwd defers rebuild to next send when session is streaming', async () => {
    const { session, backend } = makeSession()
    const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.emit({ type: 'status_change', status: 'streaming' })

    await session.switchCwd('/tmp/proj/.worktrees/abc')
    expect(backend.rebuildCalls).toHaveLength(0)
    expect(session.cwd).toBe('/tmp/proj/.worktrees/abc')

    backend.resolveSend?.()
    await pending

    const p2 = session.send({ content: 'after', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0].cwd).toBe('/tmp/proj/.worktrees/abc')
    backend.resolveSend?.()
    await p2
  })

  it('switchCwd is a no-op when target matches current cwd', async () => {
    const { session, backend } = makeSession()
    const p0 = session.send({ content: 'boot', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p0
    await session.switchCwd('/tmp/proj')
    expect(backend.rebuildCalls).toHaveLength(0)
  })

  it('switchCwd notifies state change immediately when session has messages', async () => {
    const onStateChange = vi.fn<(snapshot: SessionStateChange) => void>()
    const { session } = makeSession({
      initialMessages: [
        { id: 'u0', role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: '', providerId: 'claude-base' },
      ],
      onStateChange,
    })

    await session.switchCwd('/tmp/proj/.worktrees/abc', 'feature/x')

    expect(onStateChange).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      sid: 'sess-1',
      projectPath: '/tmp/proj',
      isWorktree: true,
      worktreePath: '/tmp/proj/.worktrees/abc',
      gitBranch: 'feature/x',
    }))
  })

  describe('worktree snapshot fields', () => {
    it('snapshot.isWorktree is false when cwd === projectPath', () => {
      const { session } = makeSession()
      expect(session.snapshot.isWorktree).toBe(false)
      expect(session.snapshot.worktreePath).toBeNull()
      expect(session.snapshot.gitBranch).toBeNull()
    })

    it('snapshot.isWorktree is true when cwd differs from projectPath', () => {
      const { session } = makeSession({ cwd: '/tmp/proj/.worktrees/abc', gitBranch: 'feature/x' })
      expect(session.snapshot.isWorktree).toBe(true)
      expect(session.snapshot.worktreePath).toBe('/tmp/proj/.worktrees/abc')
      expect(session.snapshot.gitBranch).toBe('feature/x')
    })

    it('switchCwd with gitBranch updates both cwd and gitBranch in snapshot', async () => {
      const { session } = makeSession()
      await session.switchCwd('/tmp/proj/.worktrees/abc', 'feature/x')
      expect(session.snapshot.cwd).toBe('/tmp/proj/.worktrees/abc')
      expect(session.snapshot.isWorktree).toBe(true)
      expect(session.snapshot.worktreePath).toBe('/tmp/proj/.worktrees/abc')
      expect(session.snapshot.gitBranch).toBe('feature/x')
    })

    it('switchCwd back to projectPath with null gitBranch clears worktree state', async () => {
      const { session } = makeSession({ cwd: '/tmp/proj/.worktrees/abc', gitBranch: 'feature/x' })
      await session.switchCwd('/tmp/proj', null)
      expect(session.snapshot.isWorktree).toBe(false)
      expect(session.snapshot.worktreePath).toBeNull()
      expect(session.snapshot.gitBranch).toBeNull()
    })

    it('notifyStateChange forwards isWorktree/worktreePath/gitBranch', async () => {
      const captured: Array<{ isWorktree: boolean; worktreePath: string | null; gitBranch: string | null }> = []
      const { session, backend } = makeSession({
        cwd: '/tmp/proj/.worktrees/abc',
        gitBranch: 'feature/x',
        onStateChange: (s) => { captured.push({ isWorktree: s.isWorktree, worktreePath: s.worktreePath, gitBranch: s.gitBranch }) },
      })
      const p = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      backend.emit({ type: 'message_complete', messageId: 'a1' } as AgentEvent)
      backend.resolveSend?.()
      await p
      const last = captured[captured.length - 1]
      expect(last.isWorktree).toBe(true)
      expect(last.worktreePath).toBe('/tmp/proj/.worktrees/abc')
      expect(last.gitBranch).toBe('feature/x')
    })
  })

  describe('worktreeMissing', () => {
    it('snapshot.worktreeMissing defaults to false', () => {
      const { session } = makeSession()
      expect(session.snapshot.worktreeMissing).toBe(false)
    })

    it('snapshot.worktreeMissing is true when constructed with missingWorktreePath', () => {
      const { session } = makeSession({ missingWorktreePath: '/tmp/proj/.worktrees/gone' })
      expect(session.snapshot.worktreeMissing).toBe(true)
    })

    it('emits a worktree_missing event on construction when missingWorktreePath is set', () => {
      const captured: AgentEvent[] = []
      const { session } = makeSession({ missingWorktreePath: '/tmp/proj/.worktrees/gone' })
      session.on((e) => captured.push(e))
      const wmEvents = captured.filter((e) => e.type === 'worktree_missing')
      expect(wmEvents).toHaveLength(1)
      const ev = wmEvents[0] as Extract<AgentEvent, { type: 'worktree_missing' }>
      expect(ev.worktreePath).toBe('/tmp/proj/.worktrees/gone')
      expect(ev.fallbackCwd).toBe('/tmp/proj')
      expect((ev as AgentEvent & { sessionId?: string }).sessionId).toBe(session.snapshot.id)
    })

    it('does NOT emit worktree_missing when missingWorktreePath is not set', () => {
      const captured: AgentEvent[] = []
      const { session } = makeSession({ cwd: '/tmp/proj/.worktrees/feat' })
      session.on((e) => captured.push(e))
      expect(captured.some((e) => e.type === 'worktree_missing')).toBe(false)
    })

    it('replays worktree_missing to late subscribers via on()', () => {
      const { session } = makeSession({ missingWorktreePath: '/tmp/proj/.worktrees/gone' })
      const late: AgentEvent[] = []
      session.on((e) => late.push(e))
      expect(late.filter((e) => e.type === 'worktree_missing')).toHaveLength(1)
    })

    it('notifyStateChange forwards worktreeMissing=true', async () => {
      const captured: SessionStateChange[] = []
      const { session, backend } = makeSession({
        missingWorktreePath: '/tmp/proj/.worktrees/gone',
        onStateChange: (s) => captured.push(s),
      })
      const p = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      backend.emit({ type: 'message_complete', messageId: 'a1' } as AgentEvent)
      backend.resolveSend?.()
      await p
      expect(captured.length).toBeGreaterThan(0)
      expect(captured[captured.length - 1].worktreeMissing).toBe(true)
    })
  })

  describe('init_ready event lifecycle', () => {
    function makeResources(cwd: string) {
      return {
        cwd,
        skills: [{ name: `skill@${cwd}`, description: 'd', argumentHint: '', isSkill: true }],
        projectCommands: [{ name: `cmd@${cwd}`, description: '', argumentHint: '', isSkill: false }],
        projectAgents: [{ name: `agent@${cwd}`, description: '', source: 'project' as const }],
        additionalDirectories: [`${cwd}/extra`],
      }
    }

    it('emits init_ready synchronously during construction with discovered resources', () => {
      const captured: AgentEvent[] = []
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-init',
        projectPath: '/proj',
        cwd: '/proj',
        providerId: 'claude-base',
        harnessId: 'claude',
        providerConfig: { apiKey: 'sk-x' },
        backend,
        homedir: '/home/u',
        getProjectResources: makeResources,
      })
      session.on((e) => captured.push(e))
      const initEvent = captured.find((e) => e.type === 'init_ready')
      expect(initEvent).toBeDefined()
      const ev = initEvent as Extract<AgentEvent, { type: 'init_ready' }>
      expect(ev.cwd).toBe('/proj')
      expect(ev.homedir).toBe('/home/u')
      expect(ev.skills[0].name).toBe('skill@/proj')
      expect(ev.additionalDirectories).toEqual(['/proj/extra'])
    })

    it('does NOT emit init_ready for codex harness', () => {
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-codex',
        projectPath: '/p',
        cwd: '/p',
        providerId: 'codex-base',
        harnessId: 'codex',
        providerConfig: {},
        backend,
        homedir: '/home/u',
        getProjectResources: makeResources,
      })
      const captured: AgentEvent[] = []
      session.on((e) => captured.push(e))
      expect(captured.find((e) => e.type === 'init_ready')).toBeUndefined()
    })

    it('switchCwd re-emits init_ready with new cwd resources', async () => {
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-sw',
        projectPath: '/proj',
        cwd: '/proj',
        providerId: 'claude-base',
        harnessId: 'claude',
        providerConfig: {},
        backend,
        homedir: '/h',
        getProjectResources: makeResources,
      })
      const captured: AgentEvent[] = []
      session.on((e) => { if (e.type === 'init_ready') captured.push(e) })
      expect(captured).toHaveLength(1)
      expect((captured[0] as Extract<AgentEvent, { type: 'init_ready' }>).cwd).toBe('/proj')

      await session.switchCwd('/proj/wt-1')
      expect(captured).toHaveLength(2)
      expect((captured[1] as Extract<AgentEvent, { type: 'init_ready' }>).cwd).toBe('/proj/wt-1')
      expect((captured[1] as Extract<AgentEvent, { type: 'init_ready' }>).skills[0].name).toBe('skill@/proj/wt-1')
    })

    it('on() subscribed AFTER construction still receives init_ready (replay)', () => {
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-replay',
        projectPath: '/proj',
        cwd: '/proj',
        providerId: 'claude-base',
        harnessId: 'claude',
        providerConfig: {},
        backend,
        homedir: '/h',
        getProjectResources: makeResources,
      })
      const captured: AgentEvent[] = []
      session.on((e) => captured.push(e))
      expect(captured.find((e) => e.type === 'init_ready')).toBeDefined()
    })

    it('getReplayEvents returns latest cached init_ready after switchCwd', async () => {
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-rep',
        projectPath: '/proj',
        cwd: '/proj',
        providerId: 'claude-base',
        harnessId: 'claude',
        providerConfig: {},
        backend,
        homedir: '/h',
        getProjectResources: makeResources,
      })
      await session.switchCwd('/proj/wt-after')
      const replays = session.getReplayEvents()
      expect(replays).toHaveLength(1)
      const ev = replays[0] as Extract<AgentEvent, { type: 'init_ready' }>
      expect(ev.cwd).toBe('/proj/wt-after')
    })

    it('init_ready event is tagged with sessionId and projectPath', () => {
      const backend = new FakeBackend()
      const session = new Session({
        id: 'sess-tagged',
        projectPath: '/proj-tag',
        cwd: '/proj-tag',
        providerId: 'claude-base',
        harnessId: 'claude',
        providerConfig: {},
        backend,
        homedir: '/h',
        getProjectResources: makeResources,
      })
      const captured: AgentEvent[] = []
      session.on((e) => captured.push(e))
      const ev = captured.find((e) => e.type === 'init_ready') as AgentEvent & { sessionId?: string; projectPath?: string }
      expect(ev.sessionId).toBe('sess-tagged')
      expect(ev.projectPath).toBe('/proj-tag')
    })
  })

  it('rebuilds backend with new config after updateProviderConfig on next send', async () => {
    const { session, backend } = makeSession()
    const p0 = session.send({ content: 'boot', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p0
    expect(backend.rebuildCalls).toHaveLength(0)

    session.updateProviderConfig({ apiKey: 'sk-new', baseUrl: 'https://new.example' })

    const p1 = session.send({ content: 'after rotate', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0].config).toEqual({ apiKey: 'sk-new', baseUrl: 'https://new.example' })
    backend.resolveSend?.()
    await p1

    const p2 = session.send({ content: 'again', clientMessageId: 'u2' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    backend.resolveSend?.()
    await p2
  })

  it('markNeedsRebuild forces backend rebuild on next send even when provider config is unchanged', async () => {
    const { session, backend } = makeSession()
    const p0 = session.send({ content: 'boot', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p0
    expect(backend.rebuildCalls).toHaveLength(0)

    session.markNeedsRebuild()

    const p1 = session.send({ content: 'after mini-app toggle', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    backend.resolveSend?.()
    await p1

    const p2 = session.send({ content: 'again', clientMessageId: 'u2' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    backend.resolveSend?.()
    await p2
  })

  it('fires onProviderSessionIdChange when backend emits new provider session id', () => {
    const calls: Array<[string, string]> = []
    const { backend } = makeSession({
      onProviderSessionIdChange: (sid, providerSessionId) => calls.push([sid, providerSessionId]),
    })
    backend.fireProviderSessionId('prov-abc')
    expect(calls).toEqual([['sess-1', 'prov-abc']])
    backend.fireProviderSessionId('prov-abc')
    expect(calls).toEqual([['sess-1', 'prov-abc']])
    backend.fireProviderSessionId('prov-xyz')
    expect(calls).toEqual([['sess-1', 'prov-abc'], ['sess-1', 'prov-xyz']])
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
