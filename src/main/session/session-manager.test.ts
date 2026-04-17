import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '../../shared/agent-types'
import type { BackendStartOptions, HarnessId, SessionBackend, SessionProvider } from './types'

const hoisted = vi.hoisted(() => ({
  providers: new Map<string, SessionProvider>(),
  backendsCreated: [] as SessionBackend[],
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('./session-provider-repo', () => ({
  getSessionProvider: (id: string) => hoisted.providers.get(id) ?? null,
}))

vi.mock('../agent/discover-resources', () => ({
  discoverSkills: vi.fn(() => [{ name: 'skill-1', description: 'd', argumentHint: '', isSkill: true }]),
  discoverProjectCommands: vi.fn(() => []),
  discoverProjectAgents: vi.fn(() => []),
}))

class FakeBackend implements SessionBackend {
  readonly kind: HarnessId
  started = false
  disposed = false
  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  constructor(kind: HarnessId) { this.kind = kind }

  async start(_opts: BackendStartOptions): Promise<void> { this.started = true }
  async send(_req: SendMessageRequest): Promise<void> {}
  async interrupt(): Promise<void> {}
  async close(): Promise<void> { this.disposed = true }
  async setModel(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  respondToPermission(): void {}
  respondToQuestion(): void {}
  dismissQuestion(): void {}
  respondToPlanApproval(): void {}
  async getContextUsage() { return null }
  async getMcpServerStatus() { return [] }
  async rewindFiles() { return { canRewind: false } }
  async reconnectMcp(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async reloadPlugins() { return false }
  onEvent(h: (e: AgentEvent) => void) { this.eventListeners.add(h); return () => { this.eventListeners.delete(h) } }
  onProviderSessionId(h: (id: string) => void) { this.providerSessionIdListeners.add(h); return () => { this.providerSessionIdListeners.delete(h) } }
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

function seedProvider(id: string, harnessId: HarnessId = 'claude'): SessionProvider {
  const provider: SessionProvider = {
    id,
    harnessId,
    name: `Provider ${id}`,
    isOfficial: id.endsWith('-official'),
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
    seedProvider('claude-official', 'claude')
    seedProvider('codex-official', 'codex')
    mgr = new SessionManagerImpl()
  })

  describe('createSession', () => {
    it('creates a session with a UUID that differs from the SessionProvider id', () => {
      const session = mgr.createSession({ projectPath: '/proj', providerId: 'claude-official' })
      expect(session.snapshot.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(session.snapshot.id).not.toBe('claude-official')
    })

    it('assigns the correct harnessId based on the provider', () => {
      const claude = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const codex = mgr.createSession({ projectPath: '/p', providerId: 'codex-official' })
      expect(claude.snapshot.harnessId).toBe('claude')
      expect(codex.snapshot.harnessId).toBe('codex')
    })

    it('throws when provider does not exist', () => {
      expect(() => mgr.createSession({ projectPath: '/p', providerId: 'missing' })).toThrow(/not found/)
    })

    it('each call creates an independent Session and Backend', () => {
      const a = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const b = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      expect(a.snapshot.id).not.toBe(b.snapshot.id)
      expect(hoisted.backendsCreated).toHaveLength(2)
      expect(hoisted.backendsCreated[0]).not.toBe(hoisted.backendsCreated[1])
    })
  })

  describe('getSession / listProjectSessions / disposeSession', () => {
    it('getSession returns null for unknown id', () => {
      expect(mgr.getSession('unknown')).toBeNull()
    })

    it('listProjectSessions returns only sessions for the given project', () => {
      const s1 = mgr.createSession({ projectPath: '/a', providerId: 'claude-official' })
      const s2 = mgr.createSession({ projectPath: '/a', providerId: 'codex-official' })
      mgr.createSession({ projectPath: '/b', providerId: 'claude-official' })
      const ids = mgr.listProjectSessions('/a').map((s) => s.id).sort()
      expect(ids).toEqual([s1.snapshot.id, s2.snapshot.id].sort())
    })

    it('disposeSession removes the session (closes backend only if started)', async () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const backend = hoisted.backendsCreated[0] as FakeBackend
      await s.send({ content: 'x' })
      await mgr.disposeSession(s.snapshot.id)
      expect(mgr.getSession(s.snapshot.id)).toBeNull()
      expect(backend.disposed).toBe(true)
    })

    it('disposeSession on unstarted session is safe and does not call backend.close', async () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const backend = hoisted.backendsCreated[0] as FakeBackend
      await mgr.disposeSession(s.snapshot.id)
      expect(backend.disposed).toBe(false)
    })

    it('disposeSession is a no-op for unknown id', async () => {
      await expect(mgr.disposeSession('nope')).resolves.toBeUndefined()
    })
  })

  describe('closeProject', () => {
    it('disposes all sessions belonging to the project', async () => {
      mgr.createSession({ projectPath: '/x', providerId: 'claude-official' })
      mgr.createSession({ projectPath: '/x', providerId: 'codex-official' })
      await mgr.closeProject('/x')
      expect(mgr.listProjectSessions('/x')).toEqual([])
    })
  })

  describe('event dispatch', () => {
    it('scoped on(sessionId) only receives events for that session', () => {
      const s1 = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const s2 = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const received1: AgentEvent[] = []
      const received2: AgentEvent[] = []
      mgr.on(s1.snapshot.id, (e) => received1.push(e))
      mgr.on(s2.snapshot.id, (e) => received2.push(e))

      const b1 = hoisted.backendsCreated[0] as FakeBackend
      const b2 = hoisted.backendsCreated[1] as FakeBackend
      b1.emit({ type: 'status_change', status: 'streaming' })
      b2.emit({ type: 'status_change', status: 'idle' })

      expect(received1).toHaveLength(1)
      expect(received1[0]?.type).toBe('status_change')
      expect(received2).toHaveLength(1)
    })

    it('onAny receives all events tagged with sessionId', () => {
      const s = mgr.createSession({ projectPath: '/p', providerId: 'claude-official' })
      const log: Array<{ sid: string; type: string }> = []
      mgr.onAny((sid, e) => log.push({ sid, type: e.type }))

      const b = hoisted.backendsCreated[0] as FakeBackend
      b.emit({ type: 'status_change', status: 'streaming' })
      expect(log).toEqual([{ sid: s.snapshot.id, type: 'status_change' }])
    })
  })

  describe('project resources cache', () => {
    it('getProjectResources returns discovered skills', () => {
      const resources = mgr.getProjectResources('/proj')
      expect(resources.skills).toHaveLength(1)
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
  })
})
