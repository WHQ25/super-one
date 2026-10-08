import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, RecentFolder, SendMessageRequest } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope, ExecutionEnvironmentDescriptor, ProjectSnapshot } from '@superone/shared/environment'
import { HarnessManager } from '@superone/runtime/harness'
import { openNodeDatabase } from '@superone/runtime/db'

const electron = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => {
      const id = `b-${electron.store.size}`
      electron.store.set(id, s)
      return Buffer.from(id)
    },
    decryptString: (buf: Buffer) => {
      const v = electron.store.get(buf.toString())
      if (v === undefined) throw new Error('missing')
      return v
    },
  },
}))
vi.mock('../logger', () => ({ default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } }))

import { NodeConnectionManager } from '../environment/node-connection-manager'
import { NodeCredentialStore } from '../environment/node-credential-store'
import type { RemoteControlledSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import { createDesktopProjectsPort } from './desktop-projects-port'
import { nodeControllerDeviceId, type NodeHostSessionManager, type NodeHostSessionStore } from './desktop-session-host'
import { DesktopNodeHost } from './node-host-server'

const dirs: string[] = []
const hosts: DesktopNodeHost[] = []
const managers: NodeConnectionManager[] = []

afterEach(async () => {
  for (const m of managers.splice(0)) m.disconnectAll()
  for (const h of hosts.splice(0)) await h.stop()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  electron.store.clear()
})

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

/** A desktop Session stand-in: records the owner and answers a turn with canned events. */
class FakeSession {
  owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } = { kind: 'local' }
  readonly sent: SendMessageRequest[] = []
  private readonly handlers = new Set<(event: AgentEvent, replay: boolean) => void>()
  constructor(readonly id: string, readonly cwd: string) {}
  on(handler: (event: AgentEvent, replay: boolean) => void) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  claim(owner: { kind: 'remote'; deviceId: string }) { this.owner = owner }
  release() { this.owner = { kind: 'local' } }
  activityStatus() { return 'idle' }
  setTitle() {}
  getCurrentPermissionMode() { return 'default' }
  async setPermissionMode() {}
  async setSandboxMode() {}
  async interrupt() { return true }
  async send(request: SendMessageRequest, opts?: { onAccepted?: () => void }) {
    this.sent.push(request)
    opts?.onAccepted?.()
    const user: ChatMessage = { id: request.clientMessageId ?? 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: request.content }], createdAt: new Date().toISOString(), providerId: 'claude' }
    this.emit({ type: 'user_message_appended', message: user, projectPath: '/b/project', sessionId: this.id } as AgentEvent)
    this.emit({ type: 'status_change', status: 'streaming' } as AgentEvent)
    this.emit({ type: 'status_change', status: 'idle' } as AgentEvent)
  }
  private emit(event: AgentEvent) {
    for (const h of this.handlers) h(event, false)
  }
}

class FakeSessionManager implements NodeHostSessionManager {
  readonly live = new Map<string, FakeSession>()
  private readonly listeners = new Set<(s: Session) => void>()
  active: string | null = 'local-session'
  createSession(opts: { id?: string; cwd?: string; projectPath: string }) {
    const session = new FakeSession(opts.id!, opts.cwd ?? opts.projectPath)
    this.live.set(session.id, session)
    this.active = session.id
    for (const l of this.listeners) l(session as unknown as Session)
    return session as unknown as Session
  }
  getSession(id: string) { return (this.live.get(id) as unknown as Session) ?? null }
  resumeSession(id: string) { return this.createSession({ id, projectPath: '/' }) }
  getActiveSession() { return this.active ? ({ id: this.active } as Session) : null }
  setActiveSession(_p: string, id: string) { this.active = id }
  clearActiveSession() { this.active = null }
  onSession(handler: (s: Session) => void) {
    this.listeners.add(handler)
    for (const s of this.live.values()) handler(s as unknown as Session)
    return () => this.listeners.delete(handler)
  }
}

function memoryStore(projects: () => ProjectSnapshot[]): NodeHostSessionStore & { rows: Map<string, RemoteControlledSessionRow> } {
  const rows = new Map<string, RemoteControlledSessionRow>()
  return {
    rows,
    createRow: ({ sessionId, projectPath, title }) => {
      const project = projects().find((p) => p.path === projectPath)!
      rows.set(sessionId, {
        sessionId, projectId: project.projectId, projectPath, title: title ?? null, harnessId: 'claude', providerId: null,
        providerSessionId: null, worktreePath: null, isPinned: false, isHidden: false, isUserRenamed: false, tags: [],
        createdAt: Date.now(), updatedAt: Date.now(), controller: null as unknown as RemoteControllerRecord,
      })
    },
    setController: (sessionId, controller, providerId) => {
      const row = rows.get(sessionId)
      if (!row) return false
      rows.set(sessionId, { ...row, controller, providerId: row.providerId ?? providerId ?? null })
      return true
    },
    get: (sessionId) => {
      const row = rows.get(sessionId)
      return row?.controller ? row : null
    },
    list: (projectId) => [...rows.values()].filter((r) => r.controller && (!projectId || r.projectId === projectId)),
    rename: () => {},
    loadMessages: () => ({ messages: [], cursor: null, hasMore: false }),
  }
}

describe('DesktopNodeHost', () => {
  it('serves projects and controller-owned sessions with a durable event log across restarts', async () => {
    const userData = tempDir('superone-node-host-')
    const projectDir = tempDir('superone-node-host-project-')
    execFileSync('git', ['init', '-q', projectDir])
    execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
    const folders: RecentFolder[] = [{ id: 'p1', path: projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
    const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
    const sessions = new FakeSessionManager()
    const store = memoryStore(() => projects.list())
    const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
    harnesses.enableSimulatedOverlay()
    const port = 23000 + Math.floor(Math.random() * 10000)
    const start = (bindPort: number) => DesktopNodeHost.start(
      {
        userDataDir: userData,
        label: 'Desktop B',
        appVersion: '0.0.0-test',
        sessions,
        store,
        projects,
        harnesses,
        hooks: {
          probeHarnessReadiness: () => ({ ok: true }) as never,
          assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
        },
      },
      { bindPort },
    )

    let host = await start(port)
    hosts.push(host)
    expect(host.url).toContain('127.0.0.1')

    const pairing = host.mintPairingToken()
    // Pairing outside the encrypted channel is refused.
    const plain = await fetch(`${pairing.url}/v1/pair`, { method: 'POST', body: JSON.stringify({ pairingToken: pairing.pairingToken }), headers: { 'content-type': 'application/json', connection: 'close' } })
    expect(plain.status).toBe(403)
    const manager = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a-')) })
    managers.push(manager)
    const { connectionId, descriptor } = await manager.pairAndConnect({ baseUrl: pairing.url, pairingToken: pairing.pairingToken, label: 'Desktop A', channel: pairing.channel })
    expect(descriptor.environmentId).toBe(host.identity.environmentId)
    const client = manager.getClient(connectionId)!

    const described = await client.rpc<ExecutionEnvironmentDescriptor>('environment.descriptor')
    expect(described.capabilities).toMatchObject({ sessions: true, terminal: false, workspaceFs: false, git: false, collaboration: false })
    expect(described.capabilities.harnessIds).toContain('claude')

    const listed = await client.rpc<ProjectSnapshot[]>('project.list')
    expect(listed).toEqual([expect.objectContaining({ projectId: 'p1', repoIdentity: 'git:https://example.com/acme/app.git' })])

    const created = await client.rpc<{ sessionId: string; controllerClientSessionId: string }>('session.create', {
      projectId: 'p1', harnessId: 'claude', title: 'child', systemPromptAppend: 'report back', permissionMode: 'acceptEdits',
    })
    const live = sessions.live.get(created.sessionId)!
    // Owned by the controller: this desktop's own UI cannot send into it, and its own active session is kept.
    expect(live.owner).toEqual({ kind: 'remote', deviceId: nodeControllerDeviceId(created.controllerClientSessionId) })
    expect(sessions.active).toBe('local-session')
    expect(store.rows.get(created.sessionId)?.controller).toMatchObject({ label: 'Desktop A', systemPromptAppend: 'report back', permissionMode: 'acceptEdits' })

    // Without the lease the controller cannot drive the session.
    await expect(client.rpc('session.send', { sessionId: created.sessionId, text: 'hi', leaseId: 'x', generation: '1' })).rejects.toThrow()
    const lease = await client.rpc<{ leaseId: string; generation: string }>('session.acquireControl', { sessionId: created.sessionId })
    await client.rpc('session.send', { sessionId: created.sessionId, text: 'do the task', clientMessageId: 'm1', leaseId: lease.leaseId, generation: lease.generation })
    expect(live.sent[0]).toMatchObject({ content: 'do the task', clientMessageId: 'm1' })

    const { events } = await client.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: '0' })
    const types = events.map((e) => e.eventType)
    expect(types).toEqual(['session.created', 'session.user_message', 'session.agent_event', 'session.agent_event'])
    expect(events[1].payload).toMatchObject({ blockId: 'm1', text: 'do the task' })
    expect((events[2].payload as { event: Record<string, unknown> }).event).not.toHaveProperty('projectPath')

    await expect(client.rpc('session.fork', { sessionId: created.sessionId })).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.rpc('terminal.create', { cwd: projectDir })).rejects.toMatchObject({ code: 'not_found' })
    await expect(client.rpc('harness.enable', { harnessId: 'codex' })).rejects.toMatchObject({ code: 'not_found' })

    // Restart B (on a fresh port: fetch would reuse the closed keep-alive socket): the cursor continues from the durable log.
    manager.disconnectAll()
    await host.stop()
    hosts.splice(0)
    host = await start(port + 1)
    hosts.push(host)
    const reconnected = new NodeConnectionManager({ credentialStore: new NodeCredentialStore(tempDir('superone-desktop-a2-')) })
    managers.push(reconnected)
    const again = host.mintPairingToken()
    const second = await reconnected.pairAndConnect({ baseUrl: again.url, pairingToken: again.pairingToken, label: 'Desktop A', channel: again.channel })
    const after = await reconnected.getClient(second.connectionId)!.rpc<{ events: EnvironmentEventEnvelope[] }>('session.events', { afterSequence: events[1].sequence })
    expect(after.events.map((e) => e.sequence)).toEqual(events.slice(2).map((e) => e.sequence))
    const snapshot = await reconnected.getClient(second.connectionId)!.rpc<{ snapshotSequence: string }>('session.snapshot')
    expect(snapshot.snapshotSequence).toBe(events.at(-1)!.sequence)
  })
})
