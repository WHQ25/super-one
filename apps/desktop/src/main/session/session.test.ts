import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
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
    this.activeRuntime = true
    this.startOpts = opts
  }

  prewarmCalls: BackendStartOptions[] = []
  activeRuntime = false
  releaseRuntimeCalls = 0
  hasActiveRuntime(): boolean { return this.activeRuntime }
  async releaseRuntime(): Promise<void> {
    this.releaseRuntimeCalls += 1
    this.activeRuntime = false
  }
  prewarm(opts: BackendStartOptions): void {
    this.prewarmCalls.push(opts)
    this.activeRuntime = true
  }

  rebuildCalls: BackendStartOptions[] = []
  async rebuild(opts: BackendStartOptions): Promise<void> {
    this.rebuildCalls.push(opts)
    this.activeRuntime = true
    this.startOpts = opts
  }

  dequeueMessage(_clientMessageId: string): boolean { return false }
  pendingInteractions: AgentEvent[] = []
  getPendingInteractions(): AgentEvent[] { return this.pendingInteractions }

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
  setTitleCalls: string[] = []
  async setTitle(title: string): Promise<void> { this.setTitleCalls.push(title) }
  setSessionModeCalls: string[] = []
  async setSessionMode(modeId: string): Promise<void> {
    this.setSessionModeCalls.push(modeId)
  }
  setPermissionModeCalls: import('@superone/shared/agent-types').PermissionMode[] = []
  async setPermissionMode(mode: import('@superone/shared/agent-types').PermissionMode): Promise<void> {
    this.setPermissionModeCalls.push(mode)
  }
  setSandboxCalls: import('@superone/shared/agent-types').SandboxInfo[] = []
  async setSandbox(info: import('@superone/shared/agent-types').SandboxInfo): Promise<void> {
    this.setSandboxCalls.push(info)
  }
  setAdditionalDirectoriesCalls: string[][] = []
  setAdditionalDirectoriesResult = true
  async setAdditionalDirectories(dirs: string[]): Promise<boolean> {
    this.setAdditionalDirectoriesCalls.push([...dirs])
    return this.setAdditionalDirectoriesResult
  }
  hasActiveBackgroundTasksResult = false
  hasActiveBackgroundTasks(): boolean {
    return this.hasActiveBackgroundTasksResult
  }
  stopTaskCalls: string[] = []
  async stopTask(taskId: string): Promise<void> {
    this.stopTaskCalls.push(taskId)
  }
  respondToPermission(): boolean { return true }
  respondToQuestion(): void {}
  dismissQuestion(): void {}
  respondToPlanApproval(): void {}
  async getContextUsage() { return null }
  async getMcpServerStatus() { return [] }
  async rewindFiles() { return { canRewind: false } }
  async reconnectMcp(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async reloadMcpServers(): Promise<void> {}
  async reloadPlugins(): Promise<boolean> { return false }

  onEvent(handler: (e: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => { this.providerSessionIdListeners.delete(handler) }
  }

  permissionModeAppliedListeners = new Set<(mode: import('@superone/shared/agent-types').PermissionMode) => void>()
  onPermissionModeApplied(handler: (mode: import('@superone/shared/agent-types').PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => { this.permissionModeAppliedListeners.delete(handler) }
  }

  firePermissionModeApplied(mode: import('@superone/shared/agent-types').PermissionMode): void {
    for (const cb of this.permissionModeAppliedListeners) cb(mode)
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

  it('syncs title changes only after the backend has started', async () => {
    session.setTitle('Before start', 'user')
    expect(backend.setTitleCalls).toEqual([])

    const send = session.send({ content: 'start' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    backend.resolveSend?.()
    await send

    session.setTitle('After start', 'agent')
    await vi.waitFor(() => expect(backend.setTitleCalls).toEqual(['After start']))
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

  it('reloadMcpServers forwards to the backend once started with no pending rebuild', async () => {
    const spy = vi.spyOn(backend, 'reloadMcpServers')
    const p = session.send({ content: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p

    await session.reloadMcpServers()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reloadMcpServers skips the backend when a rebuild is already pending', async () => {
    const spy = vi.spyOn(backend, 'reloadMcpServers')
    const p = session.send({ content: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p

    session.markNeedsRebuild()
    await session.reloadMcpServers()
    expect(spy).not.toHaveBeenCalled()
  })

  it('reloadMcpServers is a no-op before the backend starts', async () => {
    const spy = vi.spyOn(backend, 'reloadMcpServers')
    await session.reloadMcpServers()
    expect(spy).not.toHaveBeenCalled()
  })

  it('rebuilds a fresh codex backend after start when a rebuild is pending (tools registered before first send)', async () => {
    const { session: codexSession, backend: codexBackend } = makeSession({ harnessId: 'codex' })
    codexSession.markNeedsRebuild()

    const p = codexSession.send({ content: 'use @app' })
    await new Promise((r) => setTimeout(r, 0))
    expect(codexBackend.started).toBe(true)
    // Adopted prewarmed thread is stale → rebuild to re-snapshot tools on a fresh connection.
    expect(codexBackend.rebuildCalls).toHaveLength(1)

    codexBackend.resolveSend?.()
    await p
  })

  it('does not rebuild a fresh claude backend after start (in-process MCP reflects tools live)', async () => {
    const { session: claudeSession, backend: claudeBackend } = makeSession({ harnessId: 'claude' })
    claudeSession.markNeedsRebuild()

    const p = claudeSession.send({ content: 'use @app' })
    await new Promise((r) => setTimeout(r, 0))
    expect(claudeBackend.started).toBe(true)
    expect(claudeBackend.rebuildCalls).toHaveLength(0)

    claudeBackend.resolveSend?.()
    await p
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
    ;({ session, backend } = makeSession({ model: 'claude-opus-4-8', permissionMode: 'acceptEdits' }))
    session.prewarm()
    expect(backend.prewarmCalls).toHaveLength(1)
    expect(backend.prewarmCalls[0]).toMatchObject({
      cwd: '/tmp/proj',
      permissionMode: 'acceptEdits',
      model: 'claude-opus-4-8',
    })
  })

  it('setPermissionMode forwards to backend even when backendStarted is false (prewarm path)', async () => {
    ;({ session, backend } = makeSession({ permissionMode: 'default' }))
    // Prewarm can leave ACP/Claude runtime ready while ensureStarted has not flipped backendStarted.
    session.prewarm()
    await session.setPermissionMode('plan')
    expect(backend.setPermissionModeCalls).toEqual(['plan'])
    expect(session.permissionMode).toBe('plan')
  })

  it('setSessionMode forwards to backend even when backendStarted is false (Grok effort prewarm path)', async () => {
    ;({ session, backend } = makeSession({ permissionMode: 'default' }))
    session.prewarm()
    expect(backend.setSessionModeCalls).toEqual([])
    await session.setSessionMode('high')
    expect(backend.setSessionModeCalls).toEqual(['high'])
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
      model: 'claude-opus-4-8',
      additionalDirs: ['/extra/dir'],
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.startOpts).toMatchObject({
      effort: 'xhigh',
      model: 'claude-opus-4-8',
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

  it('setSelectedSettings effort triggers backend.rebuild on next send', async () => {
    const p1 = session.send({ content: 'first', effort: 'low' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    session.setSelectedSettings({ effort: 'xhigh' })

    const p2 = session.send({ content: 'second', effort: 'xhigh' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0]).toMatchObject({ effort: 'xhigh' })
    backend.resolveSend?.()
    await p2
  })

  it('send() with changed additionalDirs applies them in place without rebuild', async () => {
    const p1 = session.send({ content: 'first', additionalDirs: ['/a'] })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    const p2 = session.send({ content: 'second', additionalDirs: ['/a', '/b'] })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.setAdditionalDirectoriesCalls).toEqual([['/a', '/b']])
    expect(backend.rebuildCalls).toHaveLength(0)
    backend.resolveSend?.()
    await p2
  })

  it('send() with changed additionalDirs falls back to rebuild when backend cannot apply in place', async () => {
    const p1 = session.send({ content: 'first', additionalDirs: ['/a'] })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p1

    backend.setAdditionalDirectoriesResult = false
    const p2 = session.send({ content: 'second', additionalDirs: ['/b'] })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.rebuildCalls).toHaveLength(1)
    expect(backend.rebuildCalls[0]).toMatchObject({ additionalDirectories: ['/b'] })
    backend.resolveSend?.()
    await p2
  })

  describe('claude.set_additional_dirs command', () => {
    const cmd = (dirs: string[]) => ({ kind: 'claude.set_additional_dirs', dirs }) as import('./types').BackendCommand

    it('applies dirs in place even while streaming, without deferring a rebuild', async () => {
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      expect(session.snapshot.status).toBe('streaming')

      await session.dispatchBackendCommand(cmd(['/x']))

      expect(backend.setAdditionalDirectoriesCalls).toEqual([['/x']])
      expect(backend.rebuildCalls).toHaveLength(0)
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(false)

      backend.resolveSend?.()
      await pending
    })

    it('defers rebuild to next send when in-place fails while streaming', async () => {
      backend.setAdditionalDirectoriesResult = false
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))

      await session.dispatchBackendCommand(cmd(['/x']))
      expect(backend.rebuildCalls).toHaveLength(0)
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(true)

      backend.resolveSend?.()
      await pending

      const p2 = session.send({ content: 'after', clientMessageId: 'u1' })
      await new Promise((r) => setTimeout(r, 0))
      expect(backend.rebuildCalls).toHaveLength(1)
      expect(backend.rebuildCalls[0]).toMatchObject({ additionalDirectories: ['/x'] })
      backend.resolveSend?.()
      await p2
    })

    it('rebuilds immediately when in-place fails while idle', async () => {
      const p1 = session.send({ content: 'boot', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      backend.resolveSend?.()
      await p1

      backend.setAdditionalDirectoriesResult = false
      await session.dispatchBackendCommand(cmd(['/x']))

      expect(backend.rebuildCalls).toHaveLength(1)
      expect(backend.rebuildCalls[0]).toMatchObject({ additionalDirectories: ['/x'] })
    })

    it('defers rebuild when in-place fails while background tasks are running', async () => {
      const p1 = session.send({ content: 'boot', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      backend.resolveSend?.()
      await p1

      backend.setAdditionalDirectoriesResult = false
      backend.hasActiveBackgroundTasksResult = true
      await session.dispatchBackendCommand(cmd(['/x']))

      expect(backend.rebuildCalls).toHaveLength(0)
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(true)
    })
  })

  describe('claude.stop_task command', () => {
    it('forwards the taskId to backend.stopTask while streaming', async () => {
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))

      await session.dispatchBackendCommand({ kind: 'claude.stop_task', taskId: 'bg-task-1' } as import('./types').BackendCommand)

      expect(backend.stopTaskCalls).toEqual(['bg-task-1'])
      backend.resolveSend?.()
      await pending
    })

    it('is a no-op for non-claude sessions', async () => {
      ;({ session, backend } = makeSession({ harnessId: 'codex' }))
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))

      await session.dispatchBackendCommand({ kind: 'claude.stop_task', taskId: 'bg-task-1' } as import('./types').BackendCommand)

      expect(backend.stopTaskCalls).toEqual([])
      backend.resolveSend?.()
      await pending
    })
  })

  describe('setForeground', () => {
    it('keeps a visible runtime out of idle release', () => {
      backend.activeRuntime = true
      session.setForeground(true)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(false)
      session.setForeground(false)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(true)
    })

    it('ref-counts across multiple simultaneous viewers (e.g. mosaic tile + mini window)', () => {
      backend.activeRuntime = true
      session.setForeground(true)
      session.setForeground(true)
      session.setForeground(false)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(false)

      session.setForeground(false)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(true)
    })

    it('does not go negative when unmounted more times than mounted', () => {
      backend.activeRuntime = true
      session.setForeground(false)
      session.setForeground(false)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(true)

      session.setForeground(true)
      expect(session.isRuntimeIdle(Date.now() + 60_000, 0)).toBe(false)
    })
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

  it('setApiProviderId resolves new provider config and rebuilds backend on next send', async () => {
    const resolved = vi.fn((id: string | null) => ({ apiKey: id ? `key-${id}` : 'global-key' }))
    const { session: s, backend: b } = makeSession({
      providerConfig: { apiKey: 'global-key' },
      resolveProviderConfigForApiProvider: resolved,
    })

    const p1 = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p1

    s.setApiProviderId('deepseek')
    expect(resolved).toHaveBeenCalledWith('deepseek')
    expect(s.snapshot.apiProviderId).toBe('deepseek')

    const p2 = s.send({ content: 'second' })
    await new Promise((r) => setTimeout(r, 0))
    expect(b.rebuildCalls).toHaveLength(1)
    expect(b.rebuildCalls[0]).toMatchObject({ config: { apiKey: 'key-deepseek' } })
    b.resolveSend?.()
    await p2
  })

  it('setApiProviderId emits agent_setting_change with apiProviderId patch', async () => {
    const events: AgentEvent[] = []
    session.on((e) => events.push(e))
    session.setApiProviderId('openrouter')
    const settingChange = events.find((e) => e.type === 'agent_setting_change')
    expect(settingChange).toBeTruthy()
    const patch = settingChange && (settingChange as { patch?: { apiProviderId?: string | null; apiProvider?: unknown } }).patch
    expect(patch?.apiProviderId).toBe('openrouter')
    // apiProvider may be null when getActiveProvider isn't injected — the field must be present so mobile can clear stale state
    expect(patch).toHaveProperty('apiProvider')
  })

  it('setApiProviderId is no-op when value unchanged (no rebuild)', async () => {
    const resolved = vi.fn((id: string | null) => ({ apiKey: id ?? 'global' }))
    const { session: s, backend: b } = makeSession({
      providerConfig: { apiKey: 'global' },
      resolveProviderConfigForApiProvider: resolved,
      apiProviderId: 'pinned',
    })

    const p1 = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p1

    s.setApiProviderId('pinned')
    expect(resolved).not.toHaveBeenCalled()

    const p2 = s.send({ content: 'second' })
    await new Promise((r) => setTimeout(r, 0))
    expect(b.rebuildCalls).toHaveLength(0)
    b.resolveSend?.()
    await p2
  })

  it('first send on a fresh session snaps the global default id and broadcasts agent_setting_change', async () => {
    const getActiveDefault = vi.fn(() => 'anthropic-id')
    const { session: s, backend: b } = makeSession({
      getActiveDefaultApiProviderId: getActiveDefault,
    })
    const events: AgentEvent[] = []
    s.on((e) => events.push(e))

    expect(s.snapshot.apiProviderId).toBeNull()

    const p = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p

    expect(getActiveDefault).toHaveBeenCalledWith('claude')
    expect(s.snapshot.apiProviderId).toBe('anthropic-id')
    const settingChange = events.find(
      (e) => e.type === 'agent_setting_change' && (e as { patch?: { apiProviderId?: string | null } }).patch?.apiProviderId === 'anthropic-id',
    )
    expect(settingChange).toBeTruthy()
    // No rebuild — providerConfig was already resolved against this same default at construct.
    expect(b.rebuildCalls).toHaveLength(0)
  })

  it('snap is no-op once apiProviderId is already set (lock-on-first-send)', async () => {
    const getActiveDefault = vi.fn(() => 'global-default-id')
    const { session: s, backend: b } = makeSession({
      apiProviderId: 'pinned-id',
      getActiveDefaultApiProviderId: getActiveDefault,
    })
    const p = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p

    expect(getActiveDefault).not.toHaveBeenCalled()
    expect(s.snapshot.apiProviderId).toBe('pinned-id')
  })

  it('snap is skipped when no global default exists (getter returns null)', async () => {
    const { session: s, backend: b } = makeSession({
      getActiveDefaultApiProviderId: () => null,
    })
    const p = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p

    expect(s.snapshot.apiProviderId).toBeNull()
  })

  it('snap survives subsequent sends — the second send does NOT re-snap or re-broadcast', async () => {
    const getActiveDefault = vi.fn(() => 'anthropic-id')
    const { session: s, backend: b } = makeSession({
      getActiveDefaultApiProviderId: getActiveDefault,
    })
    const events: AgentEvent[] = []
    s.on((e) => events.push(e))

    const p1 = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p1

    const callsAfterFirst = getActiveDefault.mock.calls.length
    const settingEventsAfterFirst = events.filter((e) => e.type === 'agent_setting_change').length

    const p2 = s.send({ content: 'second' })
    await new Promise((r) => setTimeout(r, 0))
    b.resolveSend?.()
    await p2

    expect(getActiveDefault.mock.calls.length).toBe(callsAfterFirst)
    expect(events.filter((e) => e.type === 'agent_setting_change').length).toBe(settingEventsAfterFirst)
  })

  it('queued send during pending rebuild is promoted to normal sendChain so rebuild applies before backend.send', async () => {
    const resolved = vi.fn((id: string | null) => ({ apiKey: `key-${id ?? 'global'}` }))
    const { session: s, backend: b } = makeSession({
      providerConfig: resolved('old'),
      resolveProviderConfigForApiProvider: resolved,
      apiProviderId: 'old',
    })

    // First send goes through (becomes the streaming turn).
    const first = s.send({ content: 'first', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(b.sendCalls).toHaveLength(1)
    expect(b.startOpts).toMatchObject({ config: { apiKey: 'key-old' } })

    // User runs /provider mid-stream → setApiProviderId triggers _needsRebuild
    s.setApiProviderId('new')

    // Queued send arrives while still streaming
    const queued = s.send({ content: 'queued', clientMessageId: 'u2', priority: 'next' })
    await new Promise((r) => setTimeout(r, 0))

    // With the fix: queued is NOT delivered to backend yet — it's waiting on sendChain
    // for the rebuild to fire after current streaming finishes.
    expect(b.sendCalls).toHaveLength(1)
    expect(b.rebuildCalls).toHaveLength(0)

    // Finish first turn → sendChain releases → rebuild fires → backend.send for queued
    b.resolveSend?.()
    await first
    await new Promise((r) => setTimeout(r, 0))

    expect(b.rebuildCalls).toHaveLength(1)
    expect(b.rebuildCalls[0]).toMatchObject({ config: { apiKey: 'key-new' } })
    expect(b.sendCalls).toHaveLength(2)
    expect(b.sendCalls[1]).toMatchObject({ clientMessageId: 'u2' })

    b.resolveSend?.()
    await queued
  })

  it('snap rebuilds backend if the global default has shifted since session construction (prewarm-then-default-changed)', async () => {
    let activeId: string | null = 'old-default'
    const resolved = vi.fn((id: string | null) => ({ apiKey: `key-${id ?? 'global'}` }))
    const { session: s, backend: b } = makeSession({
      providerConfig: resolved('old-default'),
      resolveProviderConfigForApiProvider: resolved,
      getActiveDefaultApiProviderId: () => activeId,
    })

    activeId = 'new-default'

    const p = s.send({ content: 'first' })
    await new Promise((r) => setTimeout(r, 0))

    expect(b.startOpts).toMatchObject({ config: { apiKey: 'key-new-default' } })
    expect(s.snapshot.apiProviderId).toBe('new-default')

    b.resolveSend?.()
    await p
  })

  describe('setPermissionMode bypass boundary', () => {
    async function bootAndIdle(s: Session, b: FakeBackend) {
      const p = s.send({ content: 'boot', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      b.resolveSend?.()
      await p
    }

    it('idle → bypass: switches in place via backend.setPermissionMode, no rebuild', async () => {
      await bootAndIdle(session, backend)

      await session.setPermissionMode('bypassPermissions')

      expect(backend.setPermissionModeCalls).toEqual(['bypassPermissions'])
      expect(backend.rebuildCalls).toHaveLength(0)
    })

    it('bypass → default: switches in place (symmetric case)', async () => {
      ;({ session, backend } = makeSession({ permissionMode: 'bypassPermissions' }))
      await bootAndIdle(session, backend)

      await session.setPermissionMode('default')

      expect(backend.setPermissionModeCalls).toEqual(['default'])
      expect(backend.rebuildCalls).toHaveLength(0)
    })

    it('streaming + bypass switch: applies in place immediately, no deferred rebuild', async () => {
      const pending = session.send({ content: 'hi', clientMessageId: 'u0' })
      await new Promise((r) => setTimeout(r, 0))
      expect(session.snapshot.status).toBe('streaming')

      await session.setPermissionMode('bypassPermissions')
      expect(backend.setPermissionModeCalls).toEqual(['bypassPermissions'])
      expect(backend.rebuildCalls).toHaveLength(0)
      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(false)

      backend.resolveSend?.()
      await pending

      const p2 = session.send({ content: 'after', clientMessageId: 'u1' })
      await new Promise((r) => setTimeout(r, 0))
      expect(backend.rebuildCalls).toHaveLength(0)
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

    it('suggestion-driven mode change from backend syncs session.permissionMode so later switch-back is not treated as noop', async () => {
      await bootAndIdle(session, backend)
      const emitted: AgentEvent[] = []
      session.on((e) => emitted.push(e))

      backend.firePermissionModeApplied('acceptEdits')

      expect(session.getCurrentPermissionMode()).toBe('acceptEdits')
      expect(emitted.some((e) => e.type === 'permission_mode_change' && e.mode === 'acceptEdits')).toBe(true)

      await session.setPermissionMode('default')

      expect(backend.setPermissionModeCalls).toEqual(['default'])
      expect(session.getCurrentPermissionMode()).toBe('default')
    })

    it('backend-applied mode equal to current is a noop (no event, no duplicate update)', async () => {
      await bootAndIdle(session, backend)
      const emitted: AgentEvent[] = []
      session.on((e) => emitted.push(e))

      backend.firePermissionModeApplied('default')

      expect(emitted.some((e) => e.type === 'permission_mode_change')).toBe(false)
      expect(session.getCurrentPermissionMode()).toBe('default')
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

  it('records lastEventAt in snapshot when an event is forwarded', () => {
    const { session, backend } = makeSession()
    expect(session.snapshot.lastEventAt).toBe(0)

    const before = Date.now()
    backend.emit({ type: 'status_change', status: 'streaming' })
    const after = Date.now()

    expect(session.snapshot.lastEventAt).toBeGreaterThanOrEqual(before)
    expect(session.snapshot.lastEventAt).toBeLessThanOrEqual(after)
    expect(session.lastEventAt).toBe(session.snapshot.lastEventAt)
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
      providerConfig: { apiKey: 'sk-abc', model: 'claude-opus-4-8' },
      permissionMode: 'acceptEdits',
      resumedProviderSessionId: 'prior-thread',
    })
    const promise = session.send({ content: 'hello' })
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.startOpts).toMatchObject({
      cwd: '/tmp/worktree',
      config: { apiKey: 'sk-abc', model: 'claude-opus-4-8' },
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

  it('accumulates content_delta for acp harness and keeps text on message_complete', () => {
    const { session, backend } = makeSession({ harnessId: 'acp', providerId: 'acp-base' })
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'acp' },
    })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'Hi' } })
    backend.emit({ type: 'message_complete', messageId: 'a1' })

    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    expect(msg?.status).toBe('complete')
    expect(msg?.content).toEqual([{ type: 'text', text: 'Hi' }])
  })

  it('tags emitted events with a monotonic per-session seq and tracks _lastAppliedSeq on streaming message', () => {
    const { session, backend } = makeSession()
    const seen: number[] = []
    session.on((ev) => {
      if (typeof ev.seq === 'number') seen.push(ev.seq)
    })
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'X' } })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'Y' } })

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1])
    }
    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    expect(msg?._lastAppliedSeq).toBe(seen[seen.length - 1])
    expect(msg?.content).toEqual([{ type: 'text', text: 'XY' }])
  })

  it('ignores a replayed content_delta whose (epoch, seq) was already applied', () => {
    const { session, backend } = makeSession()
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    const captured: Array<{ epoch?: number; seq?: number }> = []
    session.on((ev) => {
      if (ev.type === 'content_delta') captured.push({ epoch: ev.epoch, seq: ev.seq })
    })
    backend.emit({ type: 'content_delta', messageId: 'a1', delta: { type: 'text', text: 'Hello' } })
    const first = captured[0]

    backend.emit(({
      type: 'content_delta',
      messageId: 'a1',
      delta: { type: 'text', text: 'Hello' },
      seq: first.seq,
      epoch: first.epoch,
    } as unknown as Parameters<typeof backend.emit>[0]))

    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    expect(msg?.content).toEqual([{ type: 'text', text: 'Hello' }])
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

  it('ignores replayed codex_item_delta with stale (epoch, seq)', () => {
    const { session, backend } = makeSession({
      harnessId: 'codex',
      initialMessages: [
        { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
      ],
    })
    const captured: Array<{ epoch?: number; seq?: number }> = []
    session.on((ev) => {
      if (ev.type === 'codex_item_delta') captured.push({ epoch: ev.epoch, seq: ev.seq })
    })
    backend.emit({
      type: 'codex_item_delta',
      messageId: 'a1',
      phase: 'started',
      item: { id: 'item-1', type: 'reasoning', text: 'thinking...' } as never,
    })
    const first = captured[0]

    backend.emit(({
      type: 'codex_item_delta',
      messageId: 'a1',
      phase: 'updated',
      item: { id: 'item-1', type: 'reasoning', text: 'DIFFERENT' } as never,
      epoch: first.epoch,
      seq: first.seq,
    } as unknown as Parameters<typeof backend.emit>[0]))

    const msg = session.snapshot.messages.find((m) => m.id === 'a1')
    const item = msg?.metadata?.codex?.items?.[0] as { text?: string } | undefined
    expect(item?.text).toBe('thinking...')
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

  it('codex message_complete forwards consumedTokens computed by the main runtime', () => {
    const { session, backend } = makeSession({ harnessId: 'codex' })
    const captured: AgentEvent[] = []
    session.on((e) => captured.push(e))
    const firstUsage = {
      totalInputTokens: 5628794,
      totalCachedInputTokens: 4912768,
      totalCacheWriteInputTokens: 0,
      totalOutputTokens: 48132,
      lastInputTokens: 67647,
      lastCachedInputTokens: 0,
      lastCacheWriteInputTokens: 0,
      lastOutputTokens: 21554,
      reasoningOutputTokens: 28942,
      contextWindow: 258400,
    }
    const finalUsage = {
      totalInputTokens: 5696441,
      totalCachedInputTokens: 4980224,
      totalCacheWriteInputTokens: 0,
      totalOutputTokens: 49016,
      lastInputTokens: 67647,
      lastCachedInputTokens: 67456,
      lastCacheWriteInputTokens: 0,
      lastOutputTokens: 884,
      reasoningOutputTokens: 29826,
      contextWindow: 258400,
    }

    backend.emit({
      type: 'message_start',
      message: { id: 'codex_m2_tokens', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' },
    })
    backend.emit({
      type: 'message_usage',
      messageId: 'codex_m2_tokens',
      inputTokens: firstUsage.lastInputTokens,
      outputTokens: firstUsage.lastOutputTokens,
      codexUsage: firstUsage,
    })
    backend.emit({
      type: 'message_usage',
      messageId: 'codex_m2_tokens',
      inputTokens: finalUsage.lastInputTokens,
      outputTokens: finalUsage.lastOutputTokens,
      codexUsage: finalUsage,
    })
    backend.emit({
      type: 'message_complete',
      messageId: 'codex_m2_tokens',
      metadata: {
        codex: {
          finalResponse: 'all done',
          durationMs: 42,
          items: [],
          threadId: 'thread-42',
          usage: finalUsage,
        },
      } as unknown as Record<string, unknown>,
    })

    const finished = session.snapshot.messages.find((m) => m.id === 'codex_m2_tokens')
    expect(finished?.metadata?.consumedTokens).toEqual({ input: 67838, output: 22438 })
    const completeEvent = captured.find((e) => e.type === 'message_complete') as Extract<AgentEvent, { type: 'message_complete' }> | undefined
    expect(completeEvent?.metadata?.consumedTokens).toEqual({ input: 67838, output: 22438 })
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
    expect(first.messagePersistMode.kind).toBe('incremental')
    if (first.messagePersistMode.kind === 'incremental') {
      expect(first.messagePersistMode.dirtyMessageIds).toContain('u1')
    }

    backend.resolveSend?.()
    await promise
  })

  it('persists empty transcript when truncating at the first checkpoint (index 0)', () => {
    const calls: SessionStateChange[] = []
    const { session } = makeSession({
      onStateChange: (s) => calls.push(s),
      initialMessages: [
        {
          id: 'u0',
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text: 'first' }],
          createdAt: '2026-01-01T00:00:00Z',
          providerId: 'local',
          checkpointId: 'cp-0',
        },
        {
          id: 'a0',
          role: 'assistant',
          status: 'complete',
          content: [{ type: 'text', text: 'reply' }],
          createdAt: '2026-01-01T00:00:01Z',
          providerId: 'claude',
        },
      ],
    })
    calls.length = 0
    session.truncateMessagesAt('cp-0')
    expect(session.snapshot.messages).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].messages).toEqual([])
    expect(calls[0].messagePersistMode.kind).toBe('incremental')
  })

  it('retains dirty ids when onStateChange throws and resubmits them next save', async () => {
    let failOnce = true
    const modes: SessionStateChange['messagePersistMode'][] = []
    const { session, backend } = makeSession({
      onStateChange: (s) => {
        modes.push(s.messagePersistMode)
        if (failOnce) {
          failOnce = false
          throw new Error('db down')
        }
      },
    })
    const promise = session.send({ content: 'first', clientMessageId: 'u1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(modes[0]?.kind).toBe('incremental')

    // Complete assistant → second persist should still include u1 if first failed
    backend.emit({
      type: 'message_start',
      message: { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'claude' },
    })
    backend.emit({ type: 'message_complete', messageId: 'a1' })
    const last = modes[modes.length - 1]
    expect(last.kind).toBe('incremental')
    if (last.kind === 'incremental') {
      expect(last.dirtyMessageIds).toContain('u1')
      expect(last.dirtyMessageIds).toContain('a1')
    }

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

  it('switchCwd defers rebuild while background tasks are running so they are not killed', async () => {
    const { session, backend } = makeSession()
    const p0 = session.send({ content: 'hi', clientMessageId: 'u0' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await p0

    backend.hasActiveBackgroundTasksResult = true
    await session.switchCwd('/tmp/proj/.worktrees/abc')
    expect(backend.rebuildCalls).toHaveLength(0)
    expect(session.cwd).toBe('/tmp/proj/.worktrees/abc')

    backend.hasActiveBackgroundTasksResult = false
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
        additionalDirsScoped: { user: [], projectShared: [`${cwd}/extra`], projectLocal: [] },
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
    // leaves messages empty, so nothing to persist (no stale-reconcile flag).
    backend.emit({ type: 'message_complete', messageId: 'ghost', metadata: {} })
    expect(calls).toHaveLength(0)
  })

  it('still fires onStateChange for empty transcript after truncate (stale reconcile)', () => {
    const calls: SessionStateChange[] = []
    const { session } = makeSession({
      onStateChange: (s) => calls.push(s),
      initialMessages: [
        {
          id: 'u0',
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text: 'first' }],
          createdAt: '',
          providerId: 'local',
          checkpointId: 'cp-0',
        },
      ],
    })
    calls.length = 0
    session.truncateMessagesAt('cp-0')
    expect(session.snapshot.messages).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].messages).toEqual([])
  })

  it('retains stale-reconcile flag when empty-transcript persist fails', () => {
    let failOnce = true
    const calls: SessionStateChange[] = []
    const { session } = makeSession({
      onStateChange: (s) => {
        calls.push(s)
        if (failOnce) {
          failOnce = false
          throw new Error('db down')
        }
      },
      initialMessages: [
        {
          id: 'u0',
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text: 'first' }],
          createdAt: '',
          providerId: 'local',
          checkpointId: 'cp-0',
        },
      ],
    })
    calls.length = 0
    session.truncateMessagesAt('cp-0')
    expect(calls).toHaveLength(1)
    // Metadata-only notify with empty messages should retry empty persist.
    session.setApiProviderId('retry-provider')
    expect(calls).toHaveLength(2)
    expect(calls[1].messages).toEqual([])
  })
})

describe('Session ownership', () => {
  it('starts with local owner and empty subscribers', () => {
    const { session } = makeSession()
    expect(session.owner.kind).toBe('local')
    expect(session.subscribers.size).toBe(0)
  })

  it('claim emits owner_changed only when owner actually changes', () => {
    const { session } = makeSession()
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'owner_changed', current: { kind: 'remote', deviceId: 'dev-A' } })
  })

  it('claim throws SessionClaimConflictError when another remote device already holds ownership', async () => {
    const { SessionClaimConflictError } = await import('./types')
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    expect(() => session.claim({ kind: 'remote', deviceId: 'dev-B' })).toThrow(SessionClaimConflictError)
    expect(session.owner).toEqual({ kind: 'remote', deviceId: 'dev-A' })
  })

  it('claim throws SessionClaimConflictError when another remote device is already subscribed', async () => {
    const { SessionClaimConflictError } = await import('./types')
    const { session } = makeSession()
    session.subscribe('dev-A')
    expect(() => session.claim({ kind: 'remote', deviceId: 'dev-B' })).toThrow(SessionClaimConflictError)
  })

  it('subscribe throws SessionClaimConflictError when another remote device owns the session', async () => {
    const { SessionClaimConflictError } = await import('./types')
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    expect(() => session.subscribe('dev-B')).toThrow(SessionClaimConflictError)
    expect(session.subscribers.has('dev-B')).toBe(false)
  })

  it('subscribe throws SessionClaimConflictError when another remote device is already subscribed', async () => {
    const { SessionClaimConflictError } = await import('./types')
    const { session } = makeSession()
    session.subscribe('dev-A')
    expect(() => session.subscribe('dev-B')).toThrow(SessionClaimConflictError)
    expect(session.subscribers.has('dev-B')).toBe(false)
  })

  it('subscribe is idempotent for same device that already owns', () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    session.subscribe('dev-A')
    expect(session.subscribers.has('dev-A')).toBe(true)
    expect(session.owner).toEqual({ kind: 'remote', deviceId: 'dev-A' })
  })

  it('release returns owner to local and emits owner_changed', () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    session.release('dev-A')
    expect(session.owner.kind).toBe('local')
    expect(events).toContainEqual(expect.objectContaining({ type: 'owner_changed', current: { kind: 'local' } }))
  })

  it('release by non-owner deviceId is no-op', () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    session.release('dev-B')
    expect(session.owner).toEqual({ kind: 'remote', deviceId: 'dev-A' })
    expect(events).toHaveLength(0)
  })

  it('subscribe/unsubscribe emits subscriber_added/removed and dedupes the same device', () => {
    const { session } = makeSession()
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    session.subscribe('dev-A')
    session.subscribe('dev-A')
    session.unsubscribe('dev-A')
    session.unsubscribe('dev-A')
    expect(events.map((e) => e.type)).toEqual(['subscriber_added', 'subscriber_removed'])
    expect(session.subscribers.has('dev-A')).toBe(false)
  })

  it('local-origin send is rejected with SessionLockedError when owner is remote', async () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    await expect(session.send({ content: 'hi' }, { providerOrigin: 'local' })).rejects.toThrow(/controlled by remote/)
  })

  it('local-origin send is rejected when remote subscribers exist', async () => {
    const { session } = makeSession()
    session.subscribe('dev-A')
    await expect(session.send({ content: 'hi' }, { providerOrigin: 'local' })).rejects.toThrow(/being viewed/)
  })

  it('remote-origin send bypasses both locks (so the device that owns/subscribes can act)', async () => {
    const { session, backend } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    session.subscribe('dev-A')
    const sendPromise = session.send({ content: 'hi' }, { providerOrigin: 'remote' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await sendPromise
    expect(backend.sendCalls).toHaveLength(1)
  })

  it('remote-origin send forwards user_message_appended so desktop UI can echo the message', async () => {
    const { session, backend } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    const sendPromise = session.send({ content: 'hello from mobile' }, { providerOrigin: 'remote' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await sendPromise
    const userEvent = events.find((e) => e.type === 'user_message_appended')
    expect(userEvent).toBeDefined()
    if (userEvent && userEvent.type === 'user_message_appended') {
      expect(userEvent.message.role).toBe('user')
    }
  })

  it('local-origin send forwards user_message_appended so other windows stay in sync (sender dedups by id)', async () => {
    const { session, backend } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    const sendPromise = session.send({ content: 'local' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
    await sendPromise
    const userEvent = events.find((e) => e.type === 'user_message_appended')
    expect(userEvent).toBeDefined()
    if (userEvent && userEvent.type === 'user_message_appended') {
      expect(userEvent.message.role).toBe('user')
    }
  })

  it('setPermissionMode emits both permission_mode_change AND agent_setting_change patch (multi-window broadcast)', async () => {
    const { session } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    await session.setPermissionMode('plan')
    const legacyEvent = events.find((e) => e.type === 'permission_mode_change')
    const patchEvent = events.find((e) => e.type === 'agent_setting_change')
    expect(legacyEvent).toBeDefined()
    expect(patchEvent).toBeDefined()
    if (patchEvent && patchEvent.type === 'agent_setting_change') {
      expect(patchEvent.patch?.permissionMode).toBe('plan')
    }
  })

  it('setSelectedSettings emits agent_setting_change with both legacy and patch fields', async () => {
    const { session } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    session.setSelectedSettings({ model: 'claude-opus-4-8', effort: 'high' })
    const settingEvent = events.find((e) => e.type === 'agent_setting_change')
    expect(settingEvent).toBeDefined()
    if (settingEvent && settingEvent.type === 'agent_setting_change') {
      expect(settingEvent.selectedModel).toBe('claude-opus-4-8')
      expect(settingEvent.selectedEffort).toBe('high')
      expect(settingEvent.patch?.selectedModel).toBe('claude-opus-4-8')
      expect(settingEvent.patch?.selectedEffort).toBe('high')
    }
  })

  it('setSandboxMode emits agent_setting_change patch with sandboxInfo (broadcast for cross-window)', async () => {
    const { session } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    await session.setSandboxMode('off')
    const patchEvent = events.find((e) => e.type === 'agent_setting_change')
    expect(patchEvent).toBeDefined()
    if (patchEvent && patchEvent.type === 'agent_setting_change') {
      expect(patchEvent.patch?.sandboxInfo).toEqual({ enabled: false, autoAllowBash: false })
    }
  })

  it('broadcastSettingsPatch forwards arbitrary patch fields (harness-agnostic transport)', async () => {
    const { session } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    session.broadcastSettingsPatch({ selectedCodexModel: 'gpt-5', selectedCodexCollaborationMode: 'plan' })
    const patchEvent = events.find((e) => e.type === 'agent_setting_change')
    expect(patchEvent).toBeDefined()
    if (patchEvent && patchEvent.type === 'agent_setting_change') {
      expect(patchEvent.patch?.selectedCodexModel).toBe('gpt-5')
      expect(patchEvent.patch?.selectedCodexCollaborationMode).toBe('plan')
    }
  })

  it('broadcastSettingsPatch with empty patch is a no-op', async () => {
    const { session } = makeSession()
    const events: import('@superone/shared/agent-types').AgentEvent[] = []
    session.on((e) => events.push(e))
    session.broadcastSettingsPatch({})
    expect(events.find((e) => e.type === 'agent_setting_change')).toBeUndefined()
  })

  it('dispose clears subscribers, releases owner, emits closed event', async () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    session.subscribe('dev-A')
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    await session.dispose()
    expect(session.owner.kind).toBe('local')
    expect(session.subscribers.size).toBe(0)
    expect(events.map((e) => e.type)).toContain('closed')
  })

  it('dispose tags owner_changed and subscriber_removed with reason=session_closed', async () => {
    const { session } = makeSession()
    session.claim({ kind: 'remote', deviceId: 'dev-A' })
    session.subscribe('dev-A')
    const events: import('./types').SessionLifecycleEvent[] = []
    session.onLifecycle((e) => events.push(e))
    await session.dispose()
    const ownerChanged = events.find((e) => e.type === 'owner_changed')
    const subscriberRemoved = events.find((e) => e.type === 'subscriber_removed')
    expect(ownerChanged && 'reason' in ownerChanged && ownerChanged.reason).toBe('session_closed')
    expect(subscriberRemoved && 'reason' in subscriberRemoved && subscriberRemoved.reason).toBe('session_closed')
  })
})

describe('pending interactions survive window reopen', () => {
  async function startBackend(session: Session, backend: FakeBackend): Promise<void> {
    void session.send({ content: 'go' })
    await new Promise((r) => setTimeout(r, 0))
    backend.resolveSend?.()
  }

  it('tags backend pending interactions with sessionId and projectPath so the renderer can route them after a fresh window load', async () => {
    const { session, backend } = makeSession({ id: 'sess-7', projectPath: '/tmp/proj-7' })
    backend.pendingInteractions = [
      { type: 'permission_request', request: { requestId: 'req-1', toolName: 'Bash', input: {} } } as AgentEvent,
      { type: 'ask_user_question', request: { requestId: 'q-1', questions: [] } } as AgentEvent,
      { type: 'plan_approval', request: { requestId: 'p-1', plan: 'do it' } } as AgentEvent,
    ]
    await startBackend(session, backend)

    const pending = session.getPendingInteractions()

    expect(pending).toHaveLength(3)
    for (const ev of pending) {
      expect((ev as { sessionId?: string }).sessionId).toBe('sess-7')
      expect((ev as { projectPath?: string }).projectPath).toBe('/tmp/proj-7')
    }
  })
})
