import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createTcpServer, connect, type Server, type Socket } from 'node:net'
import { WebSocketServer } from 'ws'
import type { AgentEvent, ChatMessage, RecentFolder, SendMessageRequest, SessionAgentProfile } from '@superone/shared/agent-types'
import { HarnessManager } from '@superone/runtime/harness'
import { applyEventToSession, createDefaultChatCoreSession, type ChatCoreSession } from '@superone/chat-core'
import { openNodeDatabase } from '@superone/runtime/db'
import type { ProjectSnapshot } from '@superone/shared/environment'
import type { DesktopSessionRow, RemoteControlledSessionRow } from '../db-remote-controlled-sessions'
import type { DesktopSessionRows } from './desktop-session-reads'
import type { Session, BackendCommand } from '../session/types'
import { SessionLease } from '../session/session-lease'
import { createDesktopProjectsPort } from './desktop-projects-port'
import type { NodeHostSessionManager, NodeHostSessionStore } from './desktop-session-host'
import { DesktopNodeHost, type DesktopNodeHostListen } from './node-host-server'
import { DesktopDomain, type DesktopDomainDeps } from './desktop-domain'

/** Fakes of B's session manager and store for node host integration tests. */

/** B's agent catalog: ids and labels of its keys, never key material. */
export const AGENT_PROFILES: SessionAgentProfile[] = [{
  id: 'claude-base',
  name: 'Claude',
  harnessId: 'claude',
  defaultConfig: { model: 'claude-sonnet', effort: 'high' },
  models: [{ id: 'claude-sonnet', name: 'Sonnet' }, { id: 'claude-opus', name: 'Opus' }],
  efforts: ['medium', 'high'],
  apiProviders: [{ id: 'cred-b', name: 'Anthropic', keyName: 'Team key' }],
}]

/** A desktop Session stand-in: records the owner and answers a turn with canned events. */
export class FakeSession {
  readonly lease: SessionLease
  readonly sent: SendMessageRequest[] = []
  private readonly handlers = new Set<(event: AgentEvent, replay: boolean) => void>()
  constructor(readonly id: string, readonly cwd: string, readonly projectPath = cwd) { this.lease = new SessionLease(id) }
  on(handler: (event: AgentEvent, replay: boolean) => void) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  apiProviderId: string | null = null
  getApiProviderId() { return this.apiProviderId }
  setApiProviderId(id: string | null) { this.apiProviderId = id }
  status: 'idle' | 'streaming' = 'idle'
  harnessId = 'claude'
  pending: AgentEvent[] = []
  getPendingInteractions() { return this.pending }
  getReplayEvents(): AgentEvent[] { return [] }
  getSessionGoal() { return null }
  activityStatus() { return this.status }
  setTitle() {}
  permissionMode = 'default'
  getCurrentPermissionMode() { return this.permissionMode }
  sandbox = { enabled: false, autoAllowBash: false }
  getCurrentSandboxInfo() { return this.sandbox }
  model: string | undefined
  effort: string | undefined
  mode: string | undefined
  agentPreset: string | null = null
  getUiSettings() { return { selectedAcpModeId: this.mode ?? null } }
  getAgentPreset() { return this.agentPreset }
  additionalDirectories: string[] = []
  getCallerScopedDirsSnapshot() { return this.additionalDirectories }
  async dispatchBackendCommand(command: BackendCommand) {
    this.lease.assertMutation()
    if (command.kind === 'session.set_additional_dirs') this.additionalDirectories = [...command.dirs]
  }
  setAgentPreset(value: string | null) { this.lease.assertMutation(); this.agentPreset = value }
  getSelectedModel() { return this.model }
  getSelectedEffort() { return this.effort }
  setSelectedSettings(patch: { model?: string | null; effort?: string | null; mode?: string | null }) { this.lease.assertMutation(); if (patch.model !== undefined) this.model = patch.model ?? undefined; if (patch.effort !== undefined) this.effort = patch.effort ?? undefined; if (patch.mode !== undefined) this.mode = patch.mode ?? undefined }
  async setPermissionMode(mode: string) { this.lease.assertMutation(); this.permissionMode = mode }
  async setSandboxMode(mode: string) { this.lease.assertMutation(); this.sandbox = { enabled: mode !== 'off', autoAllowBash: mode === 'auto' } }
  async interrupt() { return true }
  async send(request: SendMessageRequest, opts?: { onAccepted?: () => void }) {
    this.lease.assertMutation()
    this.sent.push(request)
    opts?.onAccepted?.()
    const user: ChatMessage = {
      id: request.clientMessageId ?? 'u1', role: 'user', status: 'complete', content: [{ type: 'text', text: request.content }], createdAt: new Date().toISOString(), providerId: 'claude',
      ...(request.collaboration ? { metadata: { source: request.source, collaboration: request.collaboration } } : {}),
    }
    this.emit({ type: 'user_message_appended', message: user, projectPath: '/b/project', sessionId: this.id } as AgentEvent)
    this.emit({ type: 'status_change', status: 'streaming' } as AgentEvent)
    this.emit({ type: 'status_change', status: 'idle' } as AgentEvent)
  }
  emitHostEvent(event: AgentEvent) {
    this.emit(event)
  }
  /** The transcript the session's events reduce to, as a live desktop Session keeps it. */
  private state: ChatCoreSession = createDefaultChatCoreSession()
  get snapshot() { return { harnessId: this.harnessId, messages: this.state.messages } }
  isStreaming() { return this.status === 'streaming' }
  private emit(event: AgentEvent) {
    this.state = { ...this.state, ...applyEventToSession(this.state, event) }
    for (const h of this.handlers) h(event, false)
  }
}

export class FakeSessionManager implements NodeHostSessionManager {
  readonly live = new Map<string, FakeSession>()
  private readonly listeners = new Set<(s: Session) => void>()
  active: string | null = 'local-session'
  createSession(opts: { id?: string; cwd?: string; projectPath: string; apiProviderId?: string | null }) {
    const session = new FakeSession(opts.id!, opts.cwd ?? opts.projectPath, opts.projectPath)
    session.apiProviderId = opts.apiProviderId ?? null
    this.live.set(session.id, session)
    this.active = session.id
    for (const l of this.listeners) l(session as unknown as Session)
    return session as unknown as Session
  }
  getSession(id: string) { return (this.live.get(id) as unknown as Session) ?? null }
  resumeSession(id: string) { return this.createSession({ id, projectPath: '/' }) }
  async disposeSession(id: string) { this.live.get(id)?.lease.dispose(); this.live.delete(id) }
  getActiveSession() { return this.active ? ({ id: this.active } as Session) : null }
  setActiveSession(_p: string, id: string) { this.active = id }
  clearActiveSession() { this.active = null }
  onSession(handler: (s: Session) => void) {
    this.listeners.add(handler)
    for (const s of this.live.values()) handler(s as unknown as Session)
    return () => this.listeners.delete(handler)
  }
}

/** Desktop session rows in memory: `rows` holds every session, the store sees the controlled ones, `all` every one. */
export function memoryStore(projects: () => ProjectSnapshot[]): NodeHostSessionStore & { rows: Map<string, DesktopSessionRow>; all: DesktopSessionRows<DesktopSessionRow> } {
  const rows = new Map<string, DesktopSessionRow>()
  const loadMessages = () => ({ messages: [], cursor: null, hasMore: false })
  return {
    rows,
    all: {
      get: (sessionId) => rows.get(sessionId) ?? null,
      list: (projectId) => [...rows.values()].filter((r) => !projectId || r.projectId === projectId),
      loadMessages,
    },
    createRow: ({ sessionId, projectPath, title }) => {
      const project = projects().find((p) => p.path === projectPath)!
      rows.set(sessionId, {
        sessionId, projectId: project.projectId, projectPath, title: title ?? null, harnessId: 'claude', providerId: null,
        providerSessionId: null, worktreePath: null, isPinned: false, isHidden: false, isUserRenamed: false, tags: [],
        createdAt: Date.now(), updatedAt: Date.now(), controller: null,
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
      return row?.controller ? row as RemoteControlledSessionRow : null
    },
    list: (projectId) => [...rows.values()].filter((r): r is RemoteControlledSessionRow => r.controller !== null && (!projectId || r.projectId === projectId)),
    rename: () => {},
    loadMessages,
  }
}


/** Desktop B serving one git project (`p1`) with fake sessions; caller stops it. */
export async function startTestDesktopNode(input: { userDataDir: string; projectDir: string; listen: DesktopNodeHostListen }) {
  execFileSync('git', ['init', '-q', input.projectDir])
  execFileSync('git', ['-C', input.projectDir, 'remote', 'add', 'origin', 'https://example.com/acme/app.git'])
  const folders: RecentFolder[] = [{ id: 'p1', path: input.projectDir, name: 'app', addedAt: '', lastOpened: new Date().toISOString() }]
  const projects = createDesktopProjectsPort({ list: () => folders, add: () => {} })
  const sessions = new FakeSessionManager()
  const store = memoryStore(() => projects.list())
  const harnesses = new HarnessManager(openNodeDatabase(':memory:'))
  harnesses.enableSimulatedOverlay()
  const host = await startDesktopNode(
    {
      userDataDir: input.userDataDir, label: 'Desktop B', appVersion: '0.0.0-test', sessions,
      store, rows: store.all, projects, harnesses,
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: {
        probeHarnessReadiness: () => ({ ok: true }) as never,
        assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
      },
    },
    input.listen,
  )
  return { host, sessions, store, close: () => stopDesktopNode(host) }
}

/**
 * Something on A's LAN that answers `/health` with B's (public) identity and
 * takes the WebSocket, but cannot prove B's channel secret: a spoofed mDNS
 * answer, or B behind a path that breaks WebSockets.
 */
export async function startSpoofedLanNode(identity: { environmentId: string; nodePublicKeyFingerprint: string }) {
  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, ...identity, identityConflict: false }))
  })
  const wss = new WebSocketServer({ server: http })
  let upgrades = 0
  wss.on('connection', (ws) => {
    upgrades += 1
    ws.on('message', () =>
      ws.send(JSON.stringify({ type: 'channel_challenge', v: 1, nonce: randomBytes(32).toString('hex'), proof: randomBytes(32).toString('hex') })),
    )
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    upgrades: () => upgrades,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate()
        wss.close()
        http.close(() => resolve())
      }),
  }
}

/** A's LAN path to B: a TCP forward that can be cut (A leaves the network) and restored. */
export async function lanPath(targetPort: number) {
  const sockets = new Set<Socket>()
  let server: Server | null = null
  const probe = createTcpServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const path = {
    url: `http://127.0.0.1:${port}`,
    up: () =>
      new Promise<void>((resolve) => {
        server = createTcpServer((inbound) => {
          const outbound = connect(targetPort, '127.0.0.1')
          for (const s of [inbound, outbound]) {
            sockets.add(s)
            s.on('close', () => sockets.delete(s))
            s.on('error', () => {})
          }
          inbound.pipe(outbound).pipe(inbound)
        })
        server.listen(port, '127.0.0.1', resolve)
      }),
    cut: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        if (!server) return resolve()
        server.close(() => resolve())
        server = null
      }),
  }
  return path
}

/** A desktop node as the app runs one: its domain, and the controller listener over it. */
export async function startDesktopNode(deps: DesktopDomainDeps, listen: DesktopNodeHostListen): Promise<DesktopNodeHost> {
  const domain = DesktopDomain.open(deps)
  try {
    return await DesktopNodeHost.start(domain, listen)
  } catch (err) {
    domain.close()
    throw err
  }
}

/** Quit: the listener, then the domain. */
export async function stopDesktopNode(host: DesktopNodeHost): Promise<void> {
  await host.stop()
  host.domain.close()
}
