import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createServer as createTcpServer, connect, type Server, type Socket } from 'node:net'
import { WebSocketServer } from 'ws'
import { vi } from 'vitest'
import type { AgentEvent, ChatMessage, RecentFolder, SendMessageRequest, SessionAgentProfile } from '@superone/shared/agent-types'
import { HarnessManager } from '@superone/runtime/harness'
import { applyEventToSession, createDefaultChatCoreSession, type ChatCoreSession } from '@superone/chat-core'
import { openNodeDatabase } from '@superone/runtime/db'
import type { ProjectSnapshot } from '@superone/shared/environment'
import { McpAppsError, type McpAppsBinding, type McpAppsProvider } from '@superone/shared/mcp-apps'
import type { DesktopSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { DesktopSessionRows } from './desktop-session-reads'
import type { Session, BackendCommand } from '../session/types'
import { harnessIdFromProviderId } from '../session/session-repo'
import { SessionLease } from '../session/session-lease'
import { createDesktopProjectsPort } from './desktop-projects-port'
import type { DesktopSessionEdits, NodeHostSessionManager } from './desktop-session-host'
import { DesktopNodeHost, type DesktopNodeHostListen } from './node-host-server'
import { DesktopDomain, type DesktopDomainDeps } from './desktop-domain'

// Fixture hosts use the catalog below, never the packaged desktop's provider DB.
vi.mock('../session/session-provider-repo', async () =>
  (await import('../../test/fixtures/session-provider-repo')).fixtureSessionProviderRepository())

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

/** B's harness hooks, without probing, installing or switching a real harness. */
export function testHarnessHooks(): DesktopDomainDeps['hooks'] {
  return {
    probeHarnessReadiness: () => ({ ok: true }) as never,
    assertSessionHarnessRuntimeReady: () => ({ ok: true, reason: 'test' }),
    enableHarness: async (harnesses, input) => harnesses.get(input.harnessId),
    disableHarness: (harnesses, id) => harnesses.get(id),
  }
}

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
  readonly commands: BackendCommand[] = []
  async dispatchBackendCommand(command: BackendCommand) {
    this.lease.assertMutation()
    this.commands.push(command)
    if (command.kind === 'session.set_additional_dirs') this.additionalDirectories = [...command.dirs]
  }
  queued: string[] = []
  async dequeueMessage(clientMessageId: string) {
    this.lease.assertMutation()
    const before = this.queued.length
    this.queued = this.queued.filter((id) => id !== clientMessageId)
    return this.queued.length < before
  }
  goal: { objective: string; status: string } | null = null
  async getCodexGoal() { return this.goal }
  async setCodexGoal(_threadId: string | null, objective: string, status = 'active') { this.lease.assertMutation(); this.goal = { objective, status }; return this.goal }
  async clearCodexGoal() { this.lease.assertMutation(); this.goal = null; return true }
  setAgentPreset(value: string | null) { this.lease.assertMutation(); this.agentPreset = value }
  getSelectedModel() { return this.model }
  getSelectedEffort() { return this.effort }
  ultracode = false
  contextWindow: number | null = null
  setSelectedSettings(patch: { model?: string | null; effort?: string | null; mode?: string | null; ultracode?: boolean; contextWindow?: number | null }) {
    this.lease.assertMutation()
    if (patch.model !== undefined) this.model = patch.model ?? undefined
    if (patch.effort !== undefined) this.effort = patch.effort ?? undefined
    if (patch.mode !== undefined) this.mode = patch.mode ?? undefined
    if (patch.ultracode !== undefined) this.ultracode = patch.ultracode
    if (patch.contextWindow !== undefined) this.contextWindow = patch.contextWindow
  }
  readonly permissionAnswers: unknown[][] = []
  respondToPermission(...args: unknown[]) { this.lease.assertMutation(); this.permissionAnswers.push(args); return true }
  /** A side chat: live only, never stored. */
  ephemeral = false
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
  /** The MCP connection this session's Apps reach; like a desktop backend, it serves only bindings to `local`. */
  mcpAppsProvider: McpAppsProvider | null = null
  async getMcpAppsProvider(binding: McpAppsBinding) {
    if (!this.mcpAppsProvider || binding.node !== 'local' || binding.session !== this.id) throw new McpAppsError('not_connected', 'MCP Apps session unavailable')
    return this.mcpAppsProvider
  }
  /** Host wakes (task notifications) the agent was given. */
  readonly wakes: string[] = []
  async injectTaskNotification(content: string) { this.wakes.push(content) }
  /** Set to refuse the next admitted wake, as a session whose backend cannot start does. */
  wakeFailure: Error | null = null
  async admitTaskNotification(content: string) {
    const failure = this.wakeFailure
    this.wakeFailure = null
    if (failure) throw failure
    this.wakes.push(content)
  }
  broadcastSettingsPatch(patch: import('@superone/shared/agent-types').SessionSettingsPatch) {
    this.lease.assertMutation()
    this.emitHostEvent({ type: 'agent_setting_change', patch, sessionId: this.id } as AgentEvent)
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
  createSession(opts: { id?: string; cwd?: string; projectPath: string; apiProviderId?: string | null; providerId?: string }) {
    const session = new FakeSession(opts.id!, opts.cwd ?? opts.projectPath, opts.projectPath)
    session.harnessId = harnessIdFromProviderId(opts.providerId ?? 'claude-base')
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

/** Desktop session rows in memory: `rows` holds every session, `all` reads them as the domain does. */
export function memoryStore(projects: () => ProjectSnapshot[]) {
  const rows = new Map<string, DesktopSessionRow>()
  const all: DesktopSessionRows<DesktopSessionRow> = {
    get: (sessionId) => rows.get(sessionId) ?? null,
    list: (projectId) => [...rows.values()].filter((r) => !projectId || r.projectId === projectId),
    loadMessages: () => ({ messages: [], cursor: null, hasMore: false }),
  }
  return {
    rows,
    all,
    createRow: ({ sessionId, projectPath, title, providerId }: Parameters<DesktopSessionEdits['create']>[0]) => {
      const project = projects().find((p) => p.path === projectPath)!
      rows.set(sessionId, {
        sessionId, projectId: project.projectId, projectPath, title: title ?? null, harnessId: harnessIdFromProviderId(providerId ?? 'claude-base'), providerId: providerId ?? null,
        providerSessionId: null, worktreePath: null, isPinned: false, isHidden: false, isUserRenamed: false, tags: [],
        createdAt: Date.now(), updatedAt: Date.now(), controller: null,
      })
    },
    setController: (sessionId: string, controller: RemoteControllerRecord, providerId?: string) => {
      const row = rows.get(sessionId)
      if (!row) return false
      rows.set(sessionId, { ...row, controller, providerId: row.providerId ?? providerId ?? null })
      return true
    },
  }
}

/** The domain's persistence edits over `memoryStore` rows; closing disposes the fake runtime. */
export function memorySessionEdits(store: ReturnType<typeof memoryStore>, sessions: FakeSessionManager): DesktopSessionEdits {
  const update = (id: string, patch: Partial<DesktopSessionRow>) => { store.rows.set(id, { ...store.rows.get(id)!, ...patch }) }
  return {
    create: store.createRow,
    setController: store.setController,
    rename: (id, title) => update(id, { title }),
    tags: (id, tags) => update(id, { tags }),
    flags: (id, flags) => update(id, flags),
    remove: (id) => { store.rows.delete(id) },
    close: (id) => sessions.disposeSession(id),
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
      rows: store.all, sessionEdits: memorySessionEdits(store, sessions), projects, harnesses,
      listAgentProfiles: () => AGENT_PROFILES,
      hooks: testHarnessHooks(),
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
