import { randomUUID } from 'node:crypto'
import {
  CONTROL_RELEASED_REASON,
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  SESSION_DURABLE_EVENT,
  type HostActionTerminalResult,
} from '@superone/shared/environment'
import type {
  AgentEvent,
  ChatMessage,
  PermissionMode,
  SandboxMode,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import type { ControlLeasePort, SessionHostPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import {
  HostActionChannel,
  type EventLog,
  type HostActionStore,
  type NodeSessionRecord,
  type NodeSessionSettings,
} from '@superone/runtime/session'
import { messageText } from '@superone/shared/node-message-catalog'
import { DESKTOP_HOST_ACTION_TOOL_GROUPS, DesktopSessionReads } from './desktop-session-reads'
import type { RemoteControlledSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { Session, SessionCreateOptions } from '../session/types'
import log from '../logger'
import { admitDesktopSessionSend, applyDesktopSessionSettings, desktopSendRequest, respondDesktopPermission, respondDesktopQuestion, respondDesktopPlan } from './desktop-session-mutations'
import { runFencedSessionControl } from '../session/control-context'
import type { DesktopRestorePorts } from '../session/session-restore-facts'

export { pendingInteractionOf } from './desktop-session-reads'

/** The SessionManager operations the node surface drives. */
export interface NodeHostSessionManager {
  createSession(opts: SessionCreateOptions): Session
  getSession(sessionId: string): Session | null
  resumeSession(sessionId: string, opts?: { permissionMode?: PermissionMode; sandboxMode?: SandboxMode; passive?: boolean }): Session
  getActiveSession(projectPath: string): Session | null
  setActiveSession(projectPath: string, sessionId: string): void
  clearActiveSession(projectPath: string): void
  disposeSession(sessionId: string): Promise<void>
  onSession(handler: (session: Session) => void): () => void
}

/** Desktop persistence for remotely controlled sessions (`db-remote-controlled-sessions.ts`). */
export interface NodeHostSessionStore {
  /** Insert the desktop session row for a new session. */
  createRow(input: { sessionId: string; projectPath: string; title?: string; cwd: string }): void
  setController(sessionId: string, controller: RemoteControllerRecord, providerId?: string): boolean
  get(sessionId: string): RemoteControlledSessionRow | null
  list(projectId?: string): RemoteControlledSessionRow[]
  rename(sessionId: string, title: string, source: 'user' | 'agent'): void
  /** Persisted transcript page (desktop end-cursor pagination). */
  loadMessages(sessionId: string, limit: number, cursor?: number): { messages: ChatMessage[]; cursor: number | null; hasMore: boolean }
}

export interface DesktopSessionHostDeps {
  environmentId: string
  restore?: DesktopRestorePorts
  sessions: NodeHostSessionManager
  store: NodeHostSessionStore
  leases: ControlLeasePort
  events: EventLog
  /** Durable Host Actions this desktop's sessions ask their controller to run. */
  hostActions: HostActionStore
  projectPath(projectId: string): string | null
  /** Pairing label of a controller, for the "started from" badge. */
  controllerLabel(clientSessionId: string): string | null
}



/**
 * The wire record of one desktop event. A user bubble becomes
 * `session.user_message` (so a controller that echoed it optimistically can
 * skip it, as with the CLI node); everything else rides losslessly as
 * `session.agent_event`, which the controller's event mapper replays as is.
 */
export function durableEventOf(event: AgentEvent): { eventType: string; payload: unknown } {
  if (event.type === 'user_message_appended') {
    const message = event.message
    return {
      eventType: SESSION_DURABLE_EVENT.userMessage,
      payload: {
        message,
        blockId: message.id,
        text: messageText(message.content),
        userMessageContent: message.content,
        ...(message.contexts ? { contexts: message.contexts } : {}),
        ...(message.metadata?.collaboration?.kind === 'initial_task'
          ? { collaboration: { kind: 'initial_task', ...(message.metadata.collaboration.fromSessionTitle ? { fromSessionTitle: message.metadata.collaboration.fromSessionTitle } : {}) } }
          : {}),
      },
    }
  }
  // Routing fields belong to this desktop's renderer, not to the wire.
  const { projectPath: _p, sessionId: _s, seq: _q, epoch: _e, ...rest } = event as AgentEvent & {
    projectPath?: string
    sessionId?: string
    seq?: number
    epoch?: number
  }
  return { eventType: SESSION_DURABLE_EVENT.agentEvent, payload: { event: rest } }
}

/** The refusal a controller gets after this desktop took the session back. */
function controlReleasedError(): Error {
  return Object.assign(new Error('this computer took the session back; reconnect to control it again'), {
    code: 'failed_precondition',
    details: { reason: CONTROL_RELEASED_REASON },
  })
}

/**
 * `session.*` on the desktop: sessions a remote controller starts here run on
 * the desktop's own SessionManager, are stored as ordinary desktop sessions
 * marked with their controller, and record their events in the durable node
 * event log so the controller resumes by sequence across reconnects and
 * restarts of this app. Only those sessions are visible through the node
 * surface; the desktop's own sessions stay private to it.
 */
export class DesktopSessionHost extends DesktopSessionReads<RemoteControlledSessionRow> implements SessionHostPort {
  /** Live Session objects this host watches for its controller (a resume makes a new one). */
  private readonly watched = new WeakSet<Session>()
  /** Event subscriptions on adopted sessions, dropped when the host stops. */
  private readonly sessionListeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private readonly hostActions: HostActionChannel
  /** Which sessions a controller started here, asked for every event read; a session joins only through `create`. */
  private readonly controlled = new Map<string, boolean>()

  constructor(private readonly deps: DesktopSessionHostDeps) {
    super({ sessions: deps.sessions, events: deps.events, rows: deps.store, environmentId: deps.environmentId, restore: deps.restore })
    this.hostActions = new HostActionChannel({
      store: deps.hostActions,
      session: (sessionId) => {
        const row = deps.store.get(sessionId)
        if (!row) return null
        const activity = deps.sessions.getSession(sessionId)?.activityStatus()
        return {
          controllerClientSessionId: row.controller.clientSessionId,
          hostActionCapabilityVersion: HOST_ACTION_CAPABILITY_VERSION,
          hostActionToolGroups: DESKTOP_HOST_ACTION_TOOL_GROUPS,
          closed: false,
          streaming: activity === 'streaming' || activity === 'background',
        }
      },
    })
    this.hostActions.reconcileAfterRestart()
    // Fires for live sessions now and every session registered later — a
    // resume from this desktop's sidebar included — so the turn hooks and the
    // controller's claim survive a dispose/resume cycle.
    this.unsubscribe = deps.sessions.onSession((session) => this.adopt(session))
  }

  /**
   * The host stops serving: no new Host Actions, and every one in flight is
   * cancelled and answered so the child's tool call returns instead of
   * waiting on a controller that can no longer reach it. Must run before the
   * node database closes.
   */
  /** The controllers can no longer reach this desktop: every Host Action waiting on one is cancelled. */
  cancelHostActions(reason: string): void {
    this.hostActions.cancelWaiting(reason)
  }

  protected override serves(sessionId: string): boolean {
    let served = this.controlled.get(sessionId)
    if (served === undefined) this.controlled.set(sessionId, served = this.deps.store.get(sessionId) !== null)
    return served
  }

  dispose(): void {
    this.disposeReads()
    this.unsubscribe()
    for (const off of this.sessionListeners) off()
    this.sessionListeners.clear()
    this.hostActions.shutdown('node_host_stopped')
  }

  /**
   * Ask the controller to run `toolName` for `sessionId` and wait for its
   * reply. Cancelled when the turn ends or `signal` aborts.
   */
  requestHostAction(input: {
    sessionId: string
    toolName: string
    args: unknown
    signal?: AbortSignal
  }): Promise<HostActionTerminalResult> {
    return this.hostActions.request({
      ...input,
      toolGroup: HOST_ACTION_TOOL_GROUPS.superone,
      // Mailbox tools: a replayed send dedupes by clientMessageId, but a replayed retrieve drains twice.
      replayPolicy: 'unsafe',
    })
  }

  /** The collaboration parent on the controller, when this session is such a child. */
  externalParentOf(sessionId: string): { sessionId: string } | null {
    return this.deps.store.get(sessionId)?.controller.externalParent ?? null
  }

  private adopt(session: Session): void {
    if (this.watched.has(session)) return
    const row = this.deps.store.get(session.id)
    if (!row) return
    this.watched.add(session)
    if (!row.controller.released) this.restoreControl(session, row.controller.clientSessionId)
    const off = session.on((event, replay) => {
      if (replay) return
      // A Host Action belongs to the turn that asked for it.
      if (event.type === 'status_change' && (event.status === 'idle' || event.status === 'error')) {
        this.hostActions.cancelForSession(session.id, 'turn_ended')
      }
    })
    this.sessionListeners.add(off)
  }

  private restoreControl(session: Session, clientSessionId: string): void {
    try {
      this.deps.leases.acquire({ resource: { environmentId: this.deps.environmentId, sessionId: session.id }, holderClientId: clientSessionId, ttlMs: 60_000 })
    } catch (err) {
      // Another device (a phone) is already attached; the lease still gates the node surface.
      log.warn('[node-host] controller claim skipped sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
    }
  }

  private assertLease(sessionId: string, clientSessionId: string, leaseId: string, generation: string): void {
    if (this.deps.store.get(sessionId)?.controller.released) throw controlReleasedError()
    this.deps.leases.assertValid({
      resource: { environmentId: this.deps.environmentId, sessionId },
      leaseId,
      generation,
      holderClientId: clientSessionId,
    })
  }

  /** The live session, resumed with its launch settings after a dispose or restart. */
  private live(row: RemoteControlledSessionRow): Session {
    const existing = this.deps.sessions.getSession(row.sessionId)
    if (existing) return existing
    const session = this.deps.sessions.resumeSession(row.sessionId, {
      permissionMode: (row.controller.permissionMode ?? undefined) as PermissionMode | undefined,
      sandboxMode: (row.controller.sandboxMode ?? undefined) as SandboxMode | undefined,
      passive: true,
    })
    this.adopt(session)
    return session
  }

  create(input: Parameters<SessionHostPort['create']>[0]): NodeSessionRecord {
    const projectPath = this.deps.projectPath(input.projectId)
    if (!projectPath) throw Object.assign(new Error(`unknown projectId: ${input.projectId}`), { code: 'not_found' })
    const clientSessionId = input.controllerClientSessionId
    if (!clientSessionId) throw Object.assign(new Error('controller required'), { code: 'invalid_argument' })
    const providerId = input.providerId ?? `${input.harnessId ?? 'claude'}-base`
    const sessionId = randomUUID()
    const cwd = input.cwd ?? projectPath
    this.deps.store.createRow({ sessionId, projectPath, title: input.title, cwd })
    const controller: RemoteControllerRecord = {
      clientSessionId,
      label: this.deps.controllerLabel(clientSessionId),
      ...(input.apiProviderId ? { apiProviderId: input.apiProviderId } : {}),
      ...(input.systemPromptAppend ? { systemPromptAppend: input.systemPromptAppend } : {}),
      ...(input.externalParent ? { externalParent: { sessionId: input.externalParent.sessionId } } : {}),
    }
    this.deps.store.setController(sessionId, controller, providerId)
    this.controlled.set(sessionId, true)
    // A remote launch must not take over which session this desktop shows.
    const previousActive = this.deps.sessions.getActiveSession(projectPath)?.id ?? null
    const session = this.deps.sessions.createSession({
      id: sessionId,
      projectPath,
      cwd,
      providerId,
      ...(input.apiProviderId ? { apiProviderId: input.apiProviderId } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.systemPromptAppend ? { systemPromptAppend: input.systemPromptAppend } : {}),
    })
    if (previousActive) this.deps.sessions.setActiveSession(projectPath, previousActive)
    else this.deps.sessions.clearActiveSession(projectPath)
    if (input.title) session.setTitle(input.title, 'agent')
    this.adopt(session)
    session.lease.grantCreatedSession()
    this.deps.events.appendSession({
      sessionId,
      eventType: SESSION_DURABLE_EVENT.created,
      payload: { projectId: input.projectId, harnessId: input.harnessId ?? 'claude', title: input.title ?? null },
    })
    return this.record(this.requireRow(sessionId))
  }

  async patchSettings(sessionId: string, patch: NodeSessionSettings): Promise<NodeSessionRecord> {
    const row = this.requireRow(sessionId)
    const pick = (value: string | null | undefined, current: string | null | undefined) => (value === undefined ? current : value)
    const controller: RemoteControllerRecord = {
      ...row.controller,
      permissionMode: pick(patch.permissionMode, row.controller.permissionMode),
      sandboxMode: pick(patch.sandboxMode, row.controller.sandboxMode),
      model: pick(patch.model, row.controller.model),
      effort: pick(patch.effort, row.controller.effort),
      apiProviderId: pick(patch.apiProviderId, row.controller.apiProviderId),
      mode: pick(patch.mode, row.controller.mode),
      agentPreset: pick(patch.agentPreset, row.controller.agentPreset),
      additionalDirectories: patch.additionalDirectories === undefined ? row.controller.additionalDirectories : patch.additionalDirectories,
    }
    const live = this.live(row)
    live.lease.assertMutation()
    await applyDesktopSessionSettings(live, patch)
    live.lease.assertMutation()
    this.deps.store.setController(sessionId, controller)
    return this.record(this.requireRow(sessionId))
  }

  validateSettings(): void { /* Desktop Session applies native harness selections. */ }

  /** Bring a live session to the stored launch settings before it runs a turn. */
  private async applySettings(session: Session, settings: RemoteControllerRecord): Promise<void> {
    try {
      await applyDesktopSessionSettings(session, settings)
    } catch (err) {
      if (['failed_precondition', 'forbidden', 'lease_stale', 'lease_required'].includes((err as { code?: string }).code ?? '')) throw err
      log.warn('[node-host] applying settings failed sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
    }
  }

  setCwd(): NodeSessionRecord {
    throw unsupportedMethodError('session.setCwd')
  }

  fork(): NodeSessionRecord {
    throw unsupportedMethodError('session.fork')
  }

  rename(sessionId: string, title: string, source: 'user' | 'agent' = 'user'): NodeSessionRecord {
    const row = this.requireRow(sessionId)
    const live = this.live(row)
    live.lease.assertMutation()
    live.setTitle(title, source)
    return this.record(this.requireRow(sessionId))
  }

  setTags(): NodeSessionRecord {
    throw unsupportedMethodError('session.setTags')
  }

  setUiFlags(): NodeSessionRecord {
    throw unsupportedMethodError('session.setUiFlags')
  }

  close(): void {
    throw unsupportedMethodError('session.close')
  }

  remove(): NodeSessionRecord | null {
    throw unsupportedMethodError('session.remove')
  }

  async send(input: Parameters<SessionHostPort['send']>[0]): Promise<unknown> {
    const row = this.requireRow(input.sessionId)
    this.assertLease(input.sessionId, input.client.clientSessionId, input.leaseId, input.generation)
    return runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, async () => {
      const session = this.live(row)
      const sendRequest = desktopSendRequest(input, session.snapshot.harnessId)
      await this.applySettings(session, {
        ...row.controller,
        permissionMode: input.permissionMode ?? row.controller.permissionMode,
        sandboxMode: input.sandboxMode ?? row.controller.sandboxMode,
        apiProviderId: input.apiProviderId ?? row.controller.apiProviderId,
      })
      const request: SendMessageRequest = {
        ...sendRequest,
        ...(input.collaboration ? {
          source: 'collaboration' as const,
          collaboration: {
            kind: 'initial_task' as const, direction: 'inbound' as const,
            ...(row.controller.label ? { fromSessionTitle: row.controller.label } : {}),
          },
        } : {}),
      }
      await admitDesktopSessionSend(session, request, input)
      return this.record(this.requireRow(input.sessionId))
    })
  }

  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void {
    this.requireRow(sessionId)
    this.assertLease(sessionId, client.clientSessionId, leaseId, generation)
    runFencedSessionControl(sessionId, client.clientSessionId, { leaseId, generation }, () => { void this.deps.sessions.getSession(sessionId)?.interrupt() })
  }

  private liveForResponse(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): Session {
    this.requireRow(sessionId)
    this.assertLease(sessionId, client.clientSessionId, leaseId, generation)
    const session = this.deps.sessions.getSession(sessionId)
    if (!session) throw Object.assign(new Error('no pending interaction'), { code: 'failed_precondition' })
    return session
  }

  respondPermission(input: Parameters<SessionHostPort['respondPermission']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => {
      const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
      respondDesktopPermission(session, input)
    })
  }

  respondQuestion(input: Parameters<SessionHostPort['respondQuestion']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => {
      const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
      respondDesktopQuestion(session, input)
    })
  }

  async respondPlan(input: Parameters<SessionHostPort['respondPlan']>[0]): Promise<void> {
    await runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => {
      const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
      return respondDesktopPlan(session, input)
    })
  }

  async modUi(): Promise<unknown> {
    throw unsupportedMethodError('session.modUi')
  }

  /**
   * This desktop's user takes the session back, as Disconnect does for a
   * phone: the controller's claim and lease end and the composer here opens.
   * The controller keeps the session and watches until it reconnects.
   */
  releaseControl(sessionId: string): void {
    const row = this.requireRow(sessionId)
    if (row.controller.released) return
    this.deps.store.setController(sessionId, { ...row.controller, released: true })
    this.deps.leases.revoke({ environmentId: this.deps.environmentId, sessionId })
    const session = this.live(row)
    session.emitHostEvent({ type: 'remote_control_changed', released: true })
  }

  admitControl(sessionId: string, controllerClientSessionId: string, opts: { reclaim: boolean }): void {
    const row = this.deps.store.get(sessionId)
    if (!row?.controller.released) return
    if (!opts.reclaim) throw controlReleasedError()
    const controller: RemoteControllerRecord = { ...row.controller, released: false }
    this.deps.store.setController(sessionId, controller)
    const session = this.live({ ...row, controller })
    session.emitHostEvent({ type: 'remote_control_changed', released: false })
  }

  rebindHostActionController(sessionId: string, controllerClientSessionId: string): unknown {
    const row = this.requireRow(sessionId)
    if (row.controller.clientSessionId === controllerClientSessionId) return null
    this.deps.store.setController(sessionId, {
      ...row.controller,
      clientSessionId: controllerClientSessionId,
      label: this.deps.controllerLabel(controllerClientSessionId),
    })
    this.hostActions.rebind(sessionId, controllerClientSessionId)
    return null
  }

  pollHostActions(input: Parameters<SessionHostPort['pollHostActions']>[0]): ReturnType<SessionHostPort['pollHostActions']> {
    return this.hostActions.poll(input)
  }

  claimHostAction(input: Parameters<SessionHostPort['claimHostAction']>[0]): ReturnType<SessionHostPort['claimHostAction']> {
    return this.hostActions.claim(input)
  }

  renewHostActionClaim(input: Parameters<SessionHostPort['renewHostActionClaim']>[0]): unknown {
    return this.hostActions.renew(input)
  }

  respondHostAction(input: Parameters<SessionHostPort['respondHostAction']>[0]): ReturnType<SessionHostPort['respondHostAction']> {
    return this.hostActions.respond(input)
  }

  async notifyArtifactsCompleted(): Promise<never> {
    throw unsupportedMethodError('session.notifyArtifactCompleted')
  }
}
