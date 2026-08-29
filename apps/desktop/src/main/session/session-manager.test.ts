import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import type { BackendStartOptions, HarnessId, SessionBackend, SessionProvider } from './types'

const hoisted = vi.hoisted(() => ({
  providers: new Map<string, SessionProvider>(),
  backendsCreated: [] as SessionBackend[],
  existsSyncMock: vi.fn<(path: string) => boolean>(() => true),
  closeMcpHttpSessions: vi.fn(async (_sessionId: string) => undefined),
  disposeDeviceAgentSession: vi.fn((_sessionId: string) => undefined),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('fs', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return { ...actual, existsSync: hoisted.existsSyncMock }
})

vi.mock('./session-provider-repo', () => ({
  getSessionProvider: (id: string) => hoisted.providers.get(id) ?? null,
}))

vi.mock('../mcp/superone-mcp-http-state', () => ({
  closeSuperoneMcpHttpSessions: hoisted.closeMcpHttpSessions,
}))

vi.mock('../device-agent', () => ({
  disposeDeviceAgentSession: hoisted.disposeDeviceAgentSession,
}))

vi.mock('../agent/discover-resources', () => ({
  discoverSkills: vi.fn((cwd: string) => [{ name: `skill-${cwd}`, description: 'd', argumentHint: '', isSkill: true }]),
  discoverProjectCommands: vi.fn((cwd: string) => [{ name: `cmd-${cwd}`, description: '', argumentHint: '', isSkill: false }]),
  discoverProjectAgents: vi.fn((cwd: string) => [{ name: `agent-${cwd}`, description: '', source: 'project' }]),
}))


vi.mock('os', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return { ...actual, homedir: () => '/fake/home' }
})

class FakeBackend implements SessionBackend {
  readonly kind: HarnessId
  started = false
  disposed = false
  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  constructor(kind: HarnessId) { this.kind = kind }

  activeRuntime = false
  releaseRuntimeCalls = 0
  pendingInteractions: AgentEvent[] = []
  activeBackgroundTasks = false
  blockSend = false
  resolveSend: (() => void) | null = null
  blockRelease = false
  resolveRelease: (() => void) | null = null
  sendCalls = 0
  hasActiveRuntime(): boolean { return this.activeRuntime }
  async releaseRuntime(): Promise<void> {
    this.releaseRuntimeCalls += 1
    if (this.blockRelease) await new Promise<void>((resolve) => { this.resolveRelease = resolve })
    this.activeRuntime = false
  }

  async start(_opts: BackendStartOptions): Promise<void> {
    this.started = true
    this.activeRuntime = true
  }
  prewarm(): void { this.activeRuntime = true }
  async rebuild(): Promise<void> { this.activeRuntime = true }
  async send(_req: SendMessageRequest): Promise<void> {
    this.sendCalls += 1
    if (this.blockSend) await new Promise<void>((resolve) => { this.resolveSend = resolve })
  }
  async interrupt(): Promise<void> {}
  async close(): Promise<void> { this.disposed = true }
  async setModel(): Promise<void> {}
  async setSessionMode(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  async setSandbox(): Promise<void> {}
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
  async reloadPlugins() { return false }
  dequeueMessage(): boolean { return false }
  getPendingInteractions(): AgentEvent[] { return this.pendingInteractions }
  hasActiveBackgroundTasks(): boolean { return this.activeBackgroundTasks }
  onEvent(h: (e: AgentEvent) => void) { this.eventListeners.add(h); return () => { this.eventListeners.delete(h) } }
  onProviderSessionId(h: (id: string) => void) { this.providerSessionIdListeners.add(h); return () => { this.providerSessionIdListeners.delete(h) } }
  onPermissionModeApplied() { return () => {} }
  emit(e: AgentEvent): void { for (const cb of this.eventListeners) cb(e) }
}

vi.mock('./harness-registry', () => ({
  harnessRegistry: {
    get: (id: HarnessId) => ({
      id,
      name: `Harness ${id}`,
      configSchema: {},
      createBackend: () => {
        const b = new FakeBackend(id)
        hoisted.backendsCreated.push(b)
        return b
      },
    }),
    list: () => [],
  },
}))

import { SessionManagerImpl } from './session-manager'
import { getRuntimeIdleTimeoutMs } from './session-runtime-policy'

function seedProvider(id: string, harnessId: HarnessId = 'claude'): SessionProvider {
  const provider: SessionProvider = {
    id,
    harnessId,
    name: `Provider ${id}`,
    isBase: id.endsWith('-base'),
    config: { apiKey: 'sk-x' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  hoisted.providers.set(id, provider)
  return provider
}

describe('SessionManager', () => {
  let mgr: SessionManagerImpl

  beforeEach(() => {
    hoisted.providers.clear()
    hoisted.backendsCreated.length = 0
    hoisted.existsSyncMock.mockReset()
    hoisted.existsSyncMock.mockReturnValue(true)
    hoisted.closeMcpHttpSessions.mockClear()
    hoisted.disposeDeviceAgentSession.mockClear()
    seedProvider('claude-base', 'claude')
    seedProvider('codex-base', 'codex')
    mgr = new SessionManagerImpl()
  })

  describe('runtime idle release', () => {
    it.each([
      [0, 20],
      [1, 20],
      [4, 20],
      [5, 10],
      [8, 10],
      [9, 5],
    ])('uses %i active runtimes => %i minute timeout', (activeCount, minutes) => {
      expect(getRuntimeIdleTimeoutMs(activeCount)).toBe(minutes * 60_000)
    })

    it.each([
      [4, 20],
      [5, 10],
      [8, 10],
      [9, 5],
    ])('releases %i idle runtimes after %i minutes', async (runtimeCount, minutes) => {
      const sessions = Array.from({ length: runtimeCount }, (_, index) => {
        const session = mgr.createSession({
          id: `runtime-${runtimeCount}-${index}`,
          projectPath: `/p-${index}`,
          providerId: 'claude-base',
        })
        session.prewarm()
        return session
      })
      const now = Date.now()

      await mgr.reapIdleRuntimes(now + (minutes - 1) * 60_000)
      expect(hoisted.backendsCreated.every((backend) => (backend as FakeBackend).releaseRuntimeCalls === 0)).toBe(true)

      await mgr.reapIdleRuntimes(now + minutes * 60_000)
      expect(hoisted.backendsCreated.every((backend) => (backend as FakeBackend).releaseRuntimeCalls === 1)).toBe(true)
      expect(sessions.every((session) => !session.hasActiveRuntime())).toBe(true)
      expect(hoisted.closeMcpHttpSessions).toHaveBeenCalledTimes(runtimeCount)
    })

    it('counts only sessions that currently hold a runtime', async () => {
      const sessions = Array.from({ length: 5 }, (_, index) => mgr.createSession({
        id: `mixed-${index}`,
        projectPath: `/mixed-${index}`,
        providerId: 'claude-base',
      }))
      sessions.slice(0, 4).forEach((session) => session.prewarm())
      const now = Date.now()

      await mgr.reapIdleRuntimes(now + 10 * 60_000)
      expect(hoisted.backendsCreated.every((backend) => (backend as FakeBackend).releaseRuntimeCalls === 0)).toBe(true)

      await mgr.reapIdleRuntimes(now + 20 * 60_000)
      expect(hoisted.backendsCreated.slice(0, 4).every((backend) => (backend as FakeBackend).releaseRuntimeCalls === 1)).toBe(true)
      expect((hoisted.backendsCreated[4] as FakeBackend).releaseRuntimeCalls).toBe(0)
    })

    it('never releases a foreground session', async () => {
      const session = mgr.createSession({ id: 'foreground', projectPath: '/foreground', providerId: 'claude-base' })
      session.prewarm()
      session.setForeground(true)

      await mgr.reapIdleRuntimes(Date.now() + 60 * 60_000)
      expect((hoisted.backendsCreated[0] as FakeBackend).releaseRuntimeCalls).toBe(0)

      session.setForeground(false)
      await mgr.reapIdleRuntimes(Date.now() + 60 * 60_000)
      expect((hoisted.backendsCreated[0] as FakeBackend).releaseRuntimeCalls).toBe(1)
    })

    it('does not release streaming, pending-interaction, or background-task sessions', async () => {
      const streaming = mgr.createSession({ id: 'streaming', projectPath: '/streaming', providerId: 'claude-base' })
      const pending = mgr.createSession({ id: 'pending', projectPath: '/pending', providerId: 'claude-base' })
      const background = mgr.createSession({ id: 'background', projectPath: '/background', providerId: 'claude-base' })
      pending.prewarm()
      background.prewarm()
      const streamingBackend = hoisted.backendsCreated[0] as FakeBackend
      const pendingBackend = hoisted.backendsCreated[1] as FakeBackend
      const backgroundBackend = hoisted.backendsCreated[2] as FakeBackend
      pendingBackend.pendingInteractions = [{ type: 'status_change', status: 'idle' } as AgentEvent]
      streamingBackend.blockSend = true
      backgroundBackend.activeBackgroundTasks = true

      const send = streaming.send({ content: 'still running' })
      await vi.waitFor(() => expect(streamingBackend.resolveSend).not.toBeNull())
      await mgr.reapIdleRuntimes(Date.now() + 60 * 60_000)

      expect(streamingBackend.releaseRuntimeCalls).toBe(0)
      expect(pendingBackend.releaseRuntimeCalls).toBe(0)
      expect(backgroundBackend.releaseRuntimeCalls).toBe(0)
      streamingBackend.resolveSend?.()
      await send
    })

    it('finishes idle cleanup before a concurrent send starts a new runtime', async () => {
      const session = mgr.createSession({ id: 'release-race', projectPath: '/release-race', providerId: 'claude-base' })
      session.prewarm()
      const backend = hoisted.backendsCreated[0] as FakeBackend
      backend.blockRelease = true

      const reap = mgr.reapIdleRuntimes(Date.now() + 60 * 60_000)
      await vi.waitFor(() => expect(backend.resolveRelease).not.toBeNull())
      const send = session.send({ content: 'resume after release' })

      await Promise.resolve()
      expect(backend.sendCalls).toBe(0)
      expect(hoisted.closeMcpHttpSessions).not.toHaveBeenCalled()

      backend.resolveRelease?.()
      await reap
      await vi.waitFor(() => expect(backend.sendCalls).toBe(1))
      expect(hoisted.closeMcpHttpSessions).toHaveBeenCalledWith('release-race')
      backend.resolveSend?.()
      await send
    })
  })

  describe('createSession', () => {
    it('creates a session with a UUID that differs from the SessionProvider id', () => {
      const session = mgr.createSession({ projectPath: '/proj', providerId: 'claude-base' })
      expect(session.snapshot.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(session.snapshot.id).not.toBe('claude-base')
    })

    it('assigns the correct harnessId based on the provider', () => {
      const claude = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const codex = mgr.createSession({ projectPath: '/p', providerId: 'codex-base' })
      expect(claude.snapshot.harnessId).toBe('claude')
      expect(codex.snapshot.harnessId).toBe('codex')
    })

    it('throws when provider does not exist', () => {
      expect(() => mgr.createSession({ projectPath: '/p', providerId: 'missing' })).toThrow(/not found/)
    })

    describe('project workspace folders', () => {
      const withWorkspaceDirs = (dirs: Record<string, string[]>) =>
        new SessionManagerImpl({ getProjectExtraDirs: (projectPath) => dirs[projectPath] ?? [] })

      it('seeds a session created without a renderer — automations, mobile, remote control', () => {
        const scoped = withWorkspaceDirs({ '/proj': ['/shared-lib'] })
        const session = scoped.createSession({ projectPath: '/proj', providerId: 'claude-base' })
        expect(session.getAdditionalDirectoriesSnapshot()).toEqual(['/shared-lib'])
      })

      it('unions with dirs the caller supplied instead of replacing them', () => {
        const scoped = withWorkspaceDirs({ '/proj': ['/shared-lib'] })
        const session = scoped.createSession({
          projectPath: '/proj',
          providerId: 'claude-base',
          additionalDirectories: ['/session-dir'],
        })
        expect(session.getAdditionalDirectoriesSnapshot()).toEqual(['/shared-lib', '/session-dir'])
      })

      it('does not list a folder twice when the caller already sent it', () => {
        const scoped = withWorkspaceDirs({ '/proj': ['/shared-lib'] })
        const session = scoped.createSession({
          projectPath: '/proj',
          providerId: 'claude-base',
          additionalDirectories: ['/shared-lib'],
        })
        expect(session.getAdditionalDirectoriesSnapshot()).toEqual(['/shared-lib'])
      })

      it('leaves the directory set untouched for a project with no workspace folders', () => {
        const scoped = withWorkspaceDirs({})
        const session = scoped.createSession({
          projectPath: '/proj',
          providerId: 'claude-base',
          additionalDirectories: ['/session-dir'],
        })
        expect(session.getAdditionalDirectoriesSnapshot()).toEqual(['/session-dir'])
      })
    })

    it('each call creates an independent Session and Backend', () => {
      const a = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const b = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      expect(a.snapshot.id).not.toBe(b.snapshot.id)
      expect(hoisted.backendsCreated).toHaveLength(2)
      expect(hoisted.backendsCreated[0]).not.toBe(hoisted.backendsCreated[1])
    })

    it('hydrates providerSessionId from DB when creating with a known session id', () => {
      seedProvider('acp-base', 'acp')
      const loadSession = vi.fn(() => ({
        projectPath: '/p',
        providerId: 'acp-base',
        providerSessionId: 'prior-grok-session',
        messages: [] as ChatMessage[],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgrWithLoad = new SessionManagerImpl({ loadSession })
      const session = mgrWithLoad.createSession({
        projectPath: '/p',
        providerId: 'acp-base',
        id: 'sid-known',
      })
      expect(loadSession).toHaveBeenCalledWith('sid-known')
      expect(session.snapshot.providerSessionId).toBe('prior-grok-session')
    })

    it('does not hydrate providerSessionId from a different provider row', () => {
      seedProvider('acp-base', 'acp')
      const loadSession = vi.fn(() => ({
        projectPath: '/p',
        providerId: 'claude-base',
        providerSessionId: 'claude-sdk-id',
        messages: [] as ChatMessage[],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgrWithLoad = new SessionManagerImpl({ loadSession })
      const session = mgrWithLoad.createSession({
        projectPath: '/p',
        providerId: 'acp-base',
        id: 'sid-known',
      })
      expect(session.snapshot.providerSessionId).toBeNull()
    })
  })

  describe('getSession / listProjectSessions / disposeSession', () => {
    it('getSession returns null for unknown id', () => {
      expect(mgr.getSession('unknown')).toBeNull()
    })

    it('listProjectSessions returns only sessions for the given project', () => {
      const s1 = mgr.createSession({ projectPath: '/a', providerId: 'claude-base' })
      const s2 = mgr.createSession({ projectPath: '/a', providerId: 'codex-base' })
      mgr.createSession({ projectPath: '/b', providerId: 'claude-base' })
      const ids = mgr.listProjectSessions('/a').map((s) => s.id).sort()
      expect(ids).toEqual([s1.snapshot.id, s2.snapshot.id].sort())
    })

    it('disposeSession removes the session and closes the backend', async () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const backend = hoisted.backendsCreated[0] as FakeBackend
      await s.send({ content: 'x' })
      await mgr.disposeSession(s.snapshot.id)
      expect(mgr.getSession(s.snapshot.id)).toBeNull()
      expect(backend.disposed).toBe(true)
      expect(hoisted.disposeDeviceAgentSession).toHaveBeenCalledWith(s.snapshot.id)
    })

    it('disposeSession on unstarted session still closes the backend', async () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const backend = hoisted.backendsCreated[0] as FakeBackend
      await mgr.disposeSession(s.snapshot.id)
      expect(backend.disposed).toBe(true)
    })

    it('disposeSession is a no-op for unknown id', async () => {
      await expect(mgr.disposeSession('nope')).resolves.toBeUndefined()
    })

    it('disposeAllSessions closes every backend and removes every live session', async () => {
      const first = mgr.createSession({ projectPath: '/a', providerId: 'claude-base' })
      const second = mgr.createSession({ projectPath: '/b', providerId: 'codex-base' })

      await mgr.disposeAllSessions()

      expect(hoisted.backendsCreated.every((backend) => (backend as FakeBackend).disposed)).toBe(true)
      expect(mgr.getSession(first.snapshot.id)).toBeNull()
      expect(mgr.getSession(second.snapshot.id)).toBeNull()
      expect(mgr.listLiveSnapshots()).toEqual([])
    })
  })

  describe('closeProject', () => {
    it('disposes all sessions belonging to the project', async () => {
      mgr.createSession({ projectPath: '/x', providerId: 'claude-base' })
      mgr.createSession({ projectPath: '/x', providerId: 'codex-base' })
      await mgr.closeProject('/x')
      expect(mgr.listProjectSessions('/x')).toEqual([])
    })
  })

  describe('event dispatch', () => {
    it('scoped on(sessionId) only receives events for that session', () => {
      const s1 = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const s2 = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const received1: AgentEvent[] = []
      const received2: AgentEvent[] = []
      mgr.on(s1.snapshot.id, (e) => received1.push(e))
      mgr.on(s2.snapshot.id, (e) => received2.push(e))

      const b1 = hoisted.backendsCreated[0] as FakeBackend
      const b2 = hoisted.backendsCreated[1] as FakeBackend
      b1.emit({ type: 'status_change', status: 'streaming' })
      b2.emit({ type: 'status_change', status: 'idle' })

      const types1 = received1.map((e) => e.type)
      const types2 = received2.map((e) => e.type)
      expect(types1).toEqual(['init_ready', 'status_change'])
      expect(types2).toEqual(['init_ready', 'status_change'])
    })

    it('onAny receives all events tagged with sessionId', () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-base' })
      const log: Array<{ sid: string; type: string }> = []
      mgr.onAny((sid, e) => log.push({ sid, type: e.type }))

      const b = hoisted.backendsCreated[0] as FakeBackend
      b.emit({ type: 'status_change', status: 'streaming' })
      expect(log).toEqual([
        { sid: s.snapshot.id, type: 'init_ready' },
        { sid: s.snapshot.id, type: 'status_change' },
      ])
    })

    it('injects projectPath into events for onAny/on listeners when missing', () => {
      mgr.createSession({ projectPath: '/route-test', providerId: 'claude-base' })
      const captured: AgentEvent[] = []
      mgr.onAny((_sid, e) => captured.push(e))

      const b = hoisted.backendsCreated[0] as FakeBackend
      b.emit({ type: 'status_change', status: 'streaming' })
      const statusChange = captured.find((e) => e.type === 'status_change')!
      expect((statusChange as AgentEvent & { projectPath?: string }).projectPath).toBe('/route-test')
    })
  })

  describe('active session per project', () => {
    it('createSession marks the new session active for its project', () => {
      const s = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(s.snapshot.id)
    })

    it('createSession on same project advances active pointer to the newest', () => {
      const a = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      const b = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(b.snapshot.id)
      expect(a.snapshot.id).not.toBe(b.snapshot.id)
    })

    it('getActiveSession returns null for unknown project', () => {
      expect(mgr.getActiveSession('/unknown')).toBeNull()
    })

    it('setActiveSession switches the active pointer', () => {
      const a = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      const b = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      mgr.setActiveSession('/pp', a.snapshot.id)
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(a.snapshot.id)
      mgr.setActiveSession('/pp', b.snapshot.id)
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(b.snapshot.id)
    })

    it('setActiveSession rejects cross-project sessions', () => {
      const a = mgr.createSession({ projectPath: '/pp-1', providerId: 'claude-base' })
      expect(() => mgr.setActiveSession('/pp-2', a.snapshot.id)).toThrow(/does not belong/)
    })

    it('setActiveSession rejects unknown session id', () => {
      expect(() => mgr.setActiveSession('/pp', 'missing')).toThrow(/not found/)
    })

    it('disposing the active session clears the pointer', async () => {
      const s = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      await mgr.disposeSession(s.snapshot.id)
      expect(mgr.getActiveSession('/pp')).toBeNull()
    })

    it('disposing a non-active session does not change the pointer', async () => {
      const a = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      const b = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      mgr.setActiveSession('/pp', a.snapshot.id)
      await mgr.disposeSession(b.snapshot.id)
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(a.snapshot.id)
    })

    it('clearActiveSession removes the pointer without disposing the session', () => {
      const s = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      mgr.clearActiveSession('/pp')
      expect(mgr.getActiveSession('/pp')).toBeNull()
      expect(mgr.getSession(s.snapshot.id)).not.toBeNull()
    })

    it('an ephemeral session never becomes active, even when asked', () => {
      const parent = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      const side = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base', ephemeral: true })

      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(parent.snapshot.id)

      // Prewarm and send both route through setActiveSession with whatever
      // session the composer belongs to — including a side chat's.
      mgr.setActiveSession('/pp', side.snapshot.id)
      expect(mgr.getActiveSession('/pp')?.snapshot.id).toBe(parent.snapshot.id)
    })
  })

  describe('live snapshots', () => {
    it('omits ephemeral sessions, which no panel would be there to render', () => {
      const parent = mgr.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      mgr.createSession({ projectPath: '/pp', providerId: 'claude-base', ephemeral: true })

      expect(mgr.listLiveSnapshots().map((e) => e.sid)).toEqual([parent.snapshot.id])
    })
  })

  describe('persistence hooks', () => {
    it('fires onSessionCreated on createSession', () => {
      const created: Array<{ id: string; projectPath: string; providerId: string }> = []
      const mgr2 = new SessionManagerImpl({
        onSessionCreated: (info) => { created.push(info) },
      })
      const s = mgr2.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      expect(created).toHaveLength(1)
      expect(created[0]?.id).toBe(s.snapshot.id)
      expect(created[0]?.projectPath).toBe('/pp')
      expect(created[0]?.providerId).toBe('claude-base')
    })

    it('fires onSessionDisposed on disposeSession', async () => {
      const disposed: string[] = []
      const mgr2 = new SessionManagerImpl({
        onSessionDisposed: (sid) => { disposed.push(sid) },
      })
      const s = mgr2.createSession({ projectPath: '/pp', providerId: 'claude-base' })
      await mgr2.disposeSession(s.snapshot.id)
      expect(disposed).toEqual([s.snapshot.id])
    })

    it('swallows hook errors without crashing createSession', () => {
      const mgr2 = new SessionManagerImpl({
        onSessionCreated: () => { throw new Error('boom') },
      })
      expect(() => mgr2.createSession({ projectPath: '/pp', providerId: 'claude-base' })).not.toThrow()
    })
  })

  describe('resolveProviderConfig hook', () => {
    it('uses the resolver to snapshot provider config at createSession time', () => {
      const resolver = vi.fn((p) => ({ apiKey: 'resolved-' + p.id }))
      const mgr2 = new SessionManagerImpl({ resolveProviderConfig: resolver })
      const session = mgr2.createSession({ projectPath: '/p', providerId: 'claude-base' })
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(resolver.mock.calls[0][0]?.id).toBe('claude-base')
      // Backend.start captures the resolved config; trigger start by send().
      return session.send({ content: 'x' }).then(() => {
        const backend = hoisted.backendsCreated[0] as FakeBackend & { startOpts?: BackendStartOptions }
        // FakeBackend doesn't capture startOpts; use spy on start instead.
        expect(backend.started).toBe(true)
      })
    })

    it('falls back to provider.config when no resolver is configured', async () => {
      const mgr2 = new SessionManagerImpl()
      const s = mgr2.createSession({ projectPath: '/p', providerId: 'claude-base' })
      expect(s.snapshot.providerId).toBe('claude-base')
    })

    it('applies the resolver on resumeSession as well', () => {
      const resolver = vi.fn(() => ({ apiKey: 'resumed-token' }))
      const loadSession = vi.fn(() => ({
        projectPath: '/p',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession, resolveProviderConfig: resolver })
      mgr2.resumeSession('sid-1')
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(resolver.mock.calls[0][0]?.id).toBe('claude-base')
    })

    it('markAllNeedsRebuild re-resolves provider config for every tracked session', () => {
      let revision = 0
      const resolver = vi.fn(() => ({ apiKey: `resolved-${++revision}` }))
      const mgr2 = new SessionManagerImpl({ resolveProviderConfig: resolver })
      const sessionA = mgr2.createSession({ projectPath: '/p-a', providerId: 'claude-base' })
      const sessionB = mgr2.createSession({ projectPath: '/p-b', providerId: 'claude-base' })
      expect(resolver).toHaveBeenCalledTimes(2)

      mgr2.markAllNeedsRebuild()

      expect(resolver).toHaveBeenCalledTimes(4)
      expect((sessionA as unknown as { providerConfig: unknown }).providerConfig).toEqual({ apiKey: 'resolved-3' })
      expect((sessionB as unknown as { providerConfig: unknown }).providerConfig).toEqual({ apiKey: 'resolved-4' })
    })

    it('markAllNeedsRebuild forces rebuild even when resolver returns equivalent provider config', () => {
      const stableConfig = { apiKey: 'stable-token' }
      const resolver = vi.fn(() => stableConfig)
      const mgr2 = new SessionManagerImpl({ resolveProviderConfig: resolver })
      const session = mgr2.createSession({ projectPath: '/p-a', providerId: 'claude-base' })

      mgr2.markAllNeedsRebuild()

      expect((session as unknown as { _needsRebuild: boolean })._needsRebuild).toBe(true)
    })

    it('markAllNeedsRebuild(harnessId) scopes the refresh to matching sessions only', () => {
      let revision = 0
      const resolver = vi.fn(() => ({ apiKey: `resolved-${++revision}` }))
      const mgr2 = new SessionManagerImpl({ resolveProviderConfig: resolver })
      const claudeSession = mgr2.createSession({ projectPath: '/p-a', providerId: 'claude-base' })
      const codexSession = mgr2.createSession({ projectPath: '/p-b', providerId: 'codex-base' })
      resolver.mockClear()
      revision = 0

      mgr2.markAllNeedsRebuild('claude')

      expect(resolver).toHaveBeenCalledTimes(1)
      expect(resolver.mock.calls[0][0]?.id).toBe('claude-base')
      expect((claudeSession as unknown as { providerConfig: unknown }).providerConfig).toEqual({ apiKey: 'resolved-1' })
      // Codex session config untouched.
      expect((codexSession as unknown as { providerConfig: unknown }).providerConfig).not.toEqual({ apiKey: 'resolved-1' })
    })
  })

  describe('resumeSession', () => {
    const sampleMessages: ChatMessage[] = [
      { id: 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'past request' }], createdAt: '2025-01-01', providerId: 'local' },
      { id: 'a1', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'past reply' }], createdAt: '2025-01-02', providerId: 'claude' },
    ]

    it('looks up session data via loadSession callback and hydrates initial state', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-resume',
        providerId: 'claude-base',
        providerSessionId: 'sdk-prior',
        messages: sampleMessages,
        totalCostUsd: 0.12,
        contextTokens: 777,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-123')

      expect(loadSession).toHaveBeenCalledWith('sid-123')
      expect(session.snapshot.id).toBe('sid-123')
      expect(session.snapshot.projectPath).toBe('/proj-resume')
      expect(session.snapshot.providerId).toBe('claude-base')
      expect(session.snapshot.providerSessionId).toBe('sdk-prior')
      expect(session.snapshot.messages).toEqual(sampleMessages)
      expect(session.snapshot.totalCostUsd).toBe(0.12)
      expect(session.snapshot.contextTokens).toBe(777)
    })

    it('restores the per-session model and effort', () => {
      const mgr2 = new SessionManagerImpl({
        loadSession: () => ({
          projectPath: '/proj-resume',
          providerId: 'claude-base',
          providerSessionId: 'sdk-prior',
          messages: sampleMessages,
          totalCostUsd: 0,
          contextTokens: 0,
          selectedModel: 'claude-opus-4-8',
          selectedEffort: 'high',
        }),
      })

      const session = mgr2.resumeSession('sid-model')

      expect(session.snapshot.selectedModel).toBe('claude-opus-4-8')
      expect(session.snapshot.selectedEffort).toBe('high')
    })

    it('sets the resumed session as active for its project', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-resume',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-777')
      expect(mgr2.getActiveSession('/proj-resume')?.snapshot.id).toBe(session.snapshot.id)
    })

    it('returns the in-memory instance without re-loading when sid already known', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-resume',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const first = mgr2.resumeSession('sid-a')
      const second = mgr2.resumeSession('sid-a')
      expect(second).toBe(first)
      expect(loadSession).toHaveBeenCalledTimes(1)
    })

    it('throws when loadSession returns null (unknown sid)', () => {
      const loadSession = vi.fn(() => null)
      const mgr2 = new SessionManagerImpl({ loadSession })
      expect(() => mgr2.resumeSession('ghost')).toThrow(/not found|unknown/i)
    })

    it('throws when no loadSession hook is configured', () => {
      const mgr2 = new SessionManagerImpl()
      expect(() => mgr2.resumeSession('sid-x')).toThrow(/loadSession/i)
    })

    it('resumes a codex session into the codex harness', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-codex',
        providerId: 'codex-base',
        providerSessionId: 'thread-abc',
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-codex')
      expect(session.snapshot.harnessId).toBe('codex')
      expect(session.snapshot.providerSessionId).toBe('thread-abc')
    })

    it('restores worktree cwd and gitBranch from saved record', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/abc',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-wt')
      expect(session.snapshot.cwd).toBe('/proj-wt/.worktrees/abc')
      expect(session.snapshot.isWorktree).toBe(true)
      expect(session.snapshot.worktreePath).toBe('/proj-wt/.worktrees/abc')
      expect(session.snapshot.gitBranch).toBe('feature/x')
    })

    it('falls back to projectPath when saved worktree path no longer exists', () => {
      hoisted.existsSyncMock.mockImplementation((path: string) => path === '/proj-wt')
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/missing',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-wt-missing')
      expect(session.snapshot.cwd).toBe('/proj-wt')
      expect(session.snapshot.isWorktree).toBe(false)
      expect(session.snapshot.worktreePath).toBeNull()
    })

    it('marks snapshot.worktreeMissing=true when saved worktree path no longer exists', () => {
      hoisted.existsSyncMock.mockImplementation((path: string) => path === '/proj-wt')
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/missing',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-wt-missing')
      expect(session.snapshot.worktreeMissing).toBe(true)
    })

    it('snapshot.worktreeMissing=false when saved worktree exists', () => {
      hoisted.existsSyncMock.mockReturnValue(true)
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/here',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const session = mgr2.resumeSession('sid-wt-here')
      expect(session.snapshot.worktreeMissing).toBe(false)
    })

    it('forwards a worktree_missing AgentEvent via onAny when the saved worktree path is gone', () => {
      hoisted.existsSyncMock.mockImplementation((path: string) => path === '/proj-wt')
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/missing',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const captured: Array<{ sid: string; event: AgentEvent }> = []
      mgr2.onAny((sid, event) => captured.push({ sid, event }))
      const session = mgr2.resumeSession('sid-wt-missing')
      const wm = captured.find((c) => c.event.type === 'worktree_missing')
      expect(wm).toBeDefined()
      expect(wm!.sid).toBe(session.snapshot.id)
      const ev = wm!.event as Extract<AgentEvent, { type: 'worktree_missing' }>
      expect(ev.worktreePath).toBe('/proj-wt/.worktrees/missing')
      expect(ev.fallbackCwd).toBe('/proj-wt')
      expect((ev as AgentEvent & { projectPath?: string }).projectPath).toBe('/proj-wt')
    })

    it('does NOT forward worktree_missing when worktree still exists', () => {
      hoisted.existsSyncMock.mockReturnValue(true)
      const loadSession = vi.fn(() => ({
        projectPath: '/proj-wt',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        worktreePath: '/proj-wt/.worktrees/here',
        gitBranch: 'feature/x',
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const captured: AgentEvent[] = []
      mgr2.onAny((_sid, event) => captured.push(event))
      mgr2.resumeSession('sid-wt-here')
      expect(captured.some((e) => e.type === 'worktree_missing')).toBe(false)
    })

    it('applies permissionMode from opts to the resumed session (not persisted stale mode)', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const session = mgr2.resumeSession('sid-pref', { permissionMode: 'acceptEdits' })

      expect(session.getCurrentPermissionMode()).toBe('acceptEdits')
    })

    it('applies sandboxMode from opts to the resumed session', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const session = mgr2.resumeSession('sid-sandbox', { sandboxMode: 'off' })

      expect(session.getCurrentSandboxInfo()).toEqual({ enabled: false, autoAllowBash: false })
    })

    it('restores human-approved collaboration settings ahead of generic resume defaults', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        permissionMode: 'bypassPermissions' as const,
        sandboxMode: 'off' as const,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const session = mgr2.resumeSession('sid-collab', {
        permissionMode: 'default',
        sandboxMode: 'on',
      })

      expect(session.getCurrentPermissionMode()).toBe('bypassPermissions')
      expect(session.getCurrentSandboxInfo()).toEqual({ enabled: false, autoAllowBash: false })
    })

    it('keeps human-approved collaboration settings after create, dispose, and resume', async () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
        permissionMode: 'acceptEdits' as const,
        sandboxMode: 'auto' as const,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const created = mgr2.createSession({
        id: 'sid-collab-cold-create',
        projectPath: '/proj',
        providerId: 'claude-base',
        permissionMode: 'default',
        sandboxMode: 'off',
      })

      expect(created.getCurrentPermissionMode()).toBe('acceptEdits')
      expect(created.getCurrentSandboxInfo()).toEqual({ enabled: true, autoAllowBash: true })

      await mgr2.disposeSession('sid-collab-cold-create')
      const resumed = mgr2.resumeSession('sid-collab-cold-create', {
        permissionMode: 'default',
        sandboxMode: 'off',
      })

      expect(resumed.getCurrentPermissionMode()).toBe('acceptEdits')
      expect(resumed.getCurrentSandboxInfo()).toEqual({ enabled: true, autoAllowBash: true })
    })

    it('resumeSession with sandboxMode="auto" enables sandbox with autoAllowBash', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const session = mgr2.resumeSession('sid-auto', { sandboxMode: 'auto' })

      expect(session.getCurrentSandboxInfo()).toEqual({ enabled: true, autoAllowBash: true })
    })

    it('resumeSession without opts leaves Session ctor defaults untouched (backward compat)', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/proj',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })

      const session = mgr2.resumeSession('sid-noopts')

      expect(session.getCurrentPermissionMode()).toBe('default')
      expect(session.getCurrentSandboxInfo()).toEqual({ enabled: true, autoAllowBash: false })
    })
  })

  describe('project resources cache', () => {
    it('getProjectResources returns discovered skills', () => {
      const resources = mgr.getProjectResources('/proj')
      expect(resources.skills).toHaveLength(1)
      expect(resources.skills[0].name).toBe('skill-/proj')
    })

    it('subsequent calls return cached result', () => {
      const a = mgr.getProjectResources('/proj')
      const b = mgr.getProjectResources('/proj')
      expect(a).toBe(b)
    })

    it('invalidate clears the cache', () => {
      const a = mgr.getProjectResources('/proj')
      mgr.invalidateProjectResources('/proj')
      const b = mgr.getProjectResources('/proj')
      expect(a).not.toBe(b)
    })

    it('different cwds get independent cached resources', () => {
      const a = mgr.getProjectResources('/proj-a')
      const b = mgr.getProjectResources('/proj-b')
      expect(a).not.toBe(b)
      expect(a.skills[0].name).toBe('skill-/proj-a')
      expect(b.skills[0].name).toBe('skill-/proj-b')
    })

    it('closeProject invalidates cache for the project and all session cwds', async () => {
      mgr.createSession({ projectPath: '/wt', cwd: '/wt/wt-1', providerId: 'claude-base' })
      mgr.getProjectResources('/wt')
      mgr.getProjectResources('/wt/wt-1')
      const beforeWt = mgr.getProjectResources('/wt')
      const beforeWorktree = mgr.getProjectResources('/wt/wt-1')
      await mgr.closeProject('/wt')
      const afterWt = mgr.getProjectResources('/wt')
      const afterWorktree = mgr.getProjectResources('/wt/wt-1')
      expect(afterWt).not.toBe(beforeWt)
      expect(afterWorktree).not.toBe(beforeWorktree)
    })
  })

  describe('init_ready event', () => {
    it('createSession immediately emits init_ready for claude harness', () => {
      const captured: AgentEvent[] = []
      mgr.onAny((_sid, e) => { if (e.type === 'init_ready') captured.push(e) })
      const s = mgr.createSession({ projectPath: '/init-test', providerId: 'claude-base' })
      expect(captured).toHaveLength(1)
      const ev = captured[0] as Extract<AgentEvent, { type: 'init_ready' }> & { sessionId: string; projectPath: string }
      expect(ev.cwd).toBe('/init-test')
      expect(ev.homedir).toBe('/fake/home')
      expect(ev.skills[0].name).toBe('skill-/init-test')
      expect(ev.projectCommands[0].name).toBe('cmd-/init-test')
      expect(ev.projectAgents[0].name).toBe('agent-/init-test')
      expect(ev.additionalDirectories).toEqual([])
      expect(ev.sessionId).toBe(s.snapshot.id)
      expect(ev.projectPath).toBe('/init-test')
    })

    it('does NOT emit init_ready for codex harness', () => {
      const captured: AgentEvent[] = []
      mgr.onAny((_sid, e) => { if (e.type === 'init_ready') captured.push(e) })
      mgr.createSession({ projectPath: '/codex-test', providerId: 'codex-base' })
      expect(captured).toHaveLength(0)
    })

    it('init_ready uses cwd not projectPath when they differ', () => {
      const captured: AgentEvent[] = []
      mgr.onAny((_sid, e) => { if (e.type === 'init_ready') captured.push(e) })
      mgr.createSession({ projectPath: '/proj', cwd: '/proj/worktree-x', providerId: 'claude-base' })
      const ev = captured[0] as Extract<AgentEvent, { type: 'init_ready' }>
      expect(ev.cwd).toBe('/proj/worktree-x')
      expect(ev.skills[0].name).toBe('skill-/proj/worktree-x')
    })

    it('mgr.on subscribed AFTER createSession still receives init_ready (replay)', () => {
      const s = mgr.createSession({ projectPath: '/replay', providerId: 'claude-base' })
      const captured: AgentEvent[] = []
      mgr.on(s.snapshot.id, (e) => captured.push(e))
      const types = captured.map((e) => e.type)
      expect(types).toContain('init_ready')
    })

    it('mgr.onAny subscribed AFTER createSession still receives init_ready (replay)', () => {
      mgr.createSession({ projectPath: '/replay-any', providerId: 'claude-base' })
      const captured: Array<{ sid: string; type: string }> = []
      mgr.onAny((sid, e) => captured.push({ sid, type: e.type }))
      expect(captured.some((c) => c.type === 'init_ready')).toBe(true)
    })

    it('resumeSession also emits init_ready immediately', () => {
      const loadSession = vi.fn(() => ({
        projectPath: '/resumed',
        providerId: 'claude-base',
        providerSessionId: null,
        messages: [] as ChatMessage[],
        totalCostUsd: 0,
        contextTokens: 0,
      }))
      const mgr2 = new SessionManagerImpl({ loadSession })
      const captured: AgentEvent[] = []
      mgr2.onAny((_sid, e) => { if (e.type === 'init_ready') captured.push(e) })
      mgr2.resumeSession('sid-resumed')
      expect(captured).toHaveLength(1)
      const ev = captured[0] as Extract<AgentEvent, { type: 'init_ready' }>
      expect(ev.cwd).toBe('/resumed')
    })
  })
})
