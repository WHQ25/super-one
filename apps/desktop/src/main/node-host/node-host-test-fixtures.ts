import type { AgentEvent, ChatMessage, SendMessageRequest, SessionAgentProfile } from '@superone/shared/agent-types'
import type { ProjectSnapshot } from '@superone/shared/environment'
import type { RemoteControlledSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { NodeHostSessionManager, NodeHostSessionStore } from './desktop-session-host'

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
  owner: { kind: 'local' } | { kind: 'remote'; deviceId: string } = { kind: 'local' }
  readonly sent: SendMessageRequest[] = []
  private readonly handlers = new Set<(event: AgentEvent, replay: boolean) => void>()
  constructor(readonly id: string, readonly cwd: string) {}
  on(handler: (event: AgentEvent, replay: boolean) => void) {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  apiProviderId: string | null = null
  getApiProviderId() { return this.apiProviderId }
  setApiProviderId(id: string | null) { this.apiProviderId = id }
  claim(owner: { kind: 'remote'; deviceId: string }) { this.owner = owner }
  release() { this.owner = { kind: 'local' } }
  status: 'idle' | 'streaming' = 'idle'
  pending: AgentEvent[] = []
  getPendingInteractions() { return this.pending }
  activityStatus() { return this.status }
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

export class FakeSessionManager implements NodeHostSessionManager {
  readonly live = new Map<string, FakeSession>()
  private readonly listeners = new Set<(s: Session) => void>()
  active: string | null = 'local-session'
  createSession(opts: { id?: string; cwd?: string; projectPath: string; apiProviderId?: string | null }) {
    const session = new FakeSession(opts.id!, opts.cwd ?? opts.projectPath)
    session.apiProviderId = opts.apiProviderId ?? null
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

export function memoryStore(projects: () => ProjectSnapshot[]): NodeHostSessionStore & { rows: Map<string, RemoteControlledSessionRow> } {
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

