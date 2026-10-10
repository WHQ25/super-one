import { randomUUID } from 'node:crypto'
import {
  CONTROL_RELEASED_REASON,
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  SESSION_DURABLE_EVENT,
  type EnvironmentEventEnvelope,
  type HostActionTerminalResult,
} from '@superone/shared/environment'
import type {
  AgentEvent,
  ChatMessage,
  ContentBlock,
  EffortLevel,
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
  type PendingInteraction,
} from '@superone/runtime/session'
import type { SessionMessageBlock } from '@superone/shared/environment'
import type { RemoteControlledSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { Session, SessionCreateOptions } from '../session/types'
import log from '../logger'

/** The SessionManager operations the node surface drives. */
export interface NodeHostSessionManager {
  createSession(opts: SessionCreateOptions): Session
  getSession(sessionId: string): Session | null
  resumeSession(sessionId: string, opts?: { permissionMode?: PermissionMode; sandboxMode?: SandboxMode; passive?: boolean }): Session
  getActiveSession(projectPath: string): Session | null
  setActiveSession(projectPath: string, sessionId: string): void
  clearActiveSession(projectPath: string): void
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
 * Host Action tool groups a controller runs for sessions served here. Only the
 * mailbox tools of a collaboration child whose parent is on the controller use
 * the channel today; the desktop runs every other tool itself.
 */
const DESKTOP_HOST_ACTION_TOOL_GROUPS = [HOST_ACTION_TOOL_GROUPS.superone]

/**
 * A live desktop prompt in the node's pending-interaction contract — the shape
 * the CLI node keeps on its session record and A's interaction gateway and
 * event mapper read. Null for events that are not prompts.
 */
export function pendingInteractionOf(event: AgentEvent, createdAt: number): PendingInteraction | null {
  switch (event.type) {
    case 'permission_request': {
      const r = event.request
      return {
        interactionId: r.requestId,
        kind: r.requestKind === 'session_agents_confirm' ? 'session_agents_confirm' : 'permission',
        toolName: r.toolName,
        ...(r.toolUseId ? { toolUseId: r.toolUseId } : {}),
        input: r.input,
        createdAt,
        allowAlwaysAllow: r.allowAlwaysAllow,
        ...(r.requestKind ? { requestKind: r.requestKind } : {}),
        ...(r.message ? { message: r.message } : {}),
        ...(r.serverName ? { serverName: r.serverName } : {}),
        ...(r.sessionAgentsConfirm ? { sessionAgentsConfirm: r.sessionAgentsConfirm as unknown as PendingInteraction['sessionAgentsConfirm'] } : {}),
        ...(r.schemaForm ? { schemaForm: r.schemaForm } : {}),
        ...(r.elicitationForm ? { elicitationForm: r.elicitationForm } : {}),
        ...(r.subtitle ? { subtitle: r.subtitle } : {}),
        ...(r.riskLevel ? { riskLevel: r.riskLevel } : {}),
        ...(r.supportsAlwaysPersist !== undefined ? { supportsAlwaysPersist: r.supportsAlwaysPersist } : {}),
        ...(r.inputRequest ? { inputRequest: r.inputRequest } : {}),
      }
    }
    case 'ask_user_question':
      return {
        interactionId: event.request.requestId,
        kind: 'question',
        toolName: 'AskUserQuestion',
        input: { questions: event.request.questions },
        createdAt,
      }
    case 'plan_approval':
      return {
        interactionId: event.request.requestId,
        kind: 'plan',
        toolName: 'ExitPlanMode',
        input: { plan: event.request.planContent, planFilePath: event.request.planFilePath },
        createdAt,
      }
    default:
      return null
  }
}

/** Session owner id a node controller claims, so the desktop's own UI only watches. */
export function nodeControllerDeviceId(clientSessionId: string): string {
  return `node:${clientSessionId}`
}

function textOf(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
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
        blockId: message.id,
        text: textOf(message.content),
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

function catalogBlock(message: ChatMessage, sortOrder: number): SessionMessageBlock {
  return {
    id: message.id,
    role: message.role,
    text: textOf(message.content),
    createdAt: Date.parse(message.createdAt) || 0,
    sortOrder,
    content: message.content,
    ...(message.contexts ? { contexts: message.contexts } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.metadata ? { metadata: message.metadata as Record<string, unknown> } : {}),
    ...(message.checkpointId ? { checkpointId: message.checkpointId } : {}),
    ...(message.resumePointId ? { resumePointId: message.resumePointId } : {}),
  }
}

function notFound(): Error {
  return Object.assign(new Error('session not found'), { code: 'not_found' })
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
export class DesktopSessionHost implements SessionHostPort {
  /** Live Session objects whose events are being recorded (a resume makes a new one). */
  private readonly recording = new WeakSet<Session>()
  /** Event subscriptions on adopted sessions, dropped when the host stops. */
  private readonly sessionListeners = new Set<() => void>()
  /** When each live prompt was first seen, so its `createdAt` is stable across reads. */
  private readonly promptSeenAt = new Map<string, number>()
  private readonly unsubscribe: () => void
  private readonly hostActions: HostActionChannel

  constructor(private readonly deps: DesktopSessionHostDeps) {
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
    // resume from this desktop's sidebar included — so recording and the
    // controller's claim survive a dispose/resume cycle.
    this.unsubscribe = deps.sessions.onSession((session) => this.adopt(session))
  }

  /**
   * The host stops serving: no new Host Actions, and every one in flight is
   * cancelled and answered so the child's tool call returns instead of
   * waiting on a controller that can no longer reach it. Must run before the
   * node database closes.
   */
  dispose(): void {
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
    if (this.recording.has(session)) return
    const row = this.deps.store.get(session.id)
    if (!row) return
    this.recording.add(session)
    if (!row.controller.released) this.claim(session, row.controller.clientSessionId)
    const off = session.on((event, replay) => {
      if (replay) return
      if (event.type === 'interaction_resolved') this.promptSeenAt.delete(event.requestId)
      // A Host Action belongs to the turn that asked for it.
      if (event.type === 'status_change' && (event.status === 'idle' || event.status === 'error')) {
        this.hostActions.cancelForSession(session.id, 'turn_ended')
      }
      try {
        const { eventType, payload } = durableEventOf(event)
        this.deps.events.appendSession({ sessionId: session.id, eventType, payload })
      } catch (err) {
        log.warn('[node-host] event append failed sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
      }
    })
    this.sessionListeners.add(off)
  }

  /** The live session's open prompt (one at a time on the wire, as on the CLI node). */
  private pendingInteraction(live: Session | null): PendingInteraction | null {
    for (const event of live?.getPendingInteractions() ?? []) {
      const id = 'request' in event && event.request && typeof event.request === 'object' ? (event.request as { requestId?: string }).requestId : undefined
      if (!id) continue
      if (!this.promptSeenAt.has(id)) this.promptSeenAt.set(id, Date.now())
      const pending = pendingInteractionOf(event, this.promptSeenAt.get(id)!)
      if (pending) return pending
    }
    return null
  }

  private claim(session: Session, clientSessionId: string): void {
    try {
      session.claim({ kind: 'remote', deviceId: nodeControllerDeviceId(clientSessionId) })
    } catch (err) {
      // Another device (a phone) is already attached; the lease still gates the node surface.
      log.warn('[node-host] controller claim skipped sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
    }
  }

  private record(row: RemoteControlledSessionRow): NodeSessionRecord {
    const live = this.deps.sessions.getSession(row.sessionId)
    const activity = live?.activityStatus()
    return {
      sessionId: row.sessionId,
      projectId: row.projectId,
      harnessId: row.harnessId,
      providerId: row.providerId ?? `${row.harnessId}-base`,
      title: row.title,
      status: activity === 'streaming' || activity === 'background' ? 'streaming' : activity === 'error' ? 'error' : 'idle',
      // Messages are served by session.messages.list from the desktop transcript.
      transcript: [],
      pendingInteraction: this.pendingInteraction(live),
      providerResume: row.providerSessionId,
      cwd: live?.cwd ?? row.worktreePath ?? row.projectPath,
      permissionMode: row.controller.permissionMode ?? null,
      sandboxMode: row.controller.sandboxMode ?? null,
      model: row.controller.model ?? null,
      effort: row.controller.effort ?? null,
      apiProviderId: row.controller.apiProviderId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isPinned: row.isPinned,
      isHidden: row.isHidden,
      isUserRenamed: row.isUserRenamed,
      tags: row.tags,
      controllerClientSessionId: row.controller.clientSessionId,
      ...(row.controller.released ? { controlReleased: true } : {}),
      hostActionCapabilityVersion: HOST_ACTION_CAPABILITY_VERSION,
      hostActionToolGroups: [...DESKTOP_HOST_ACTION_TOOL_GROUPS],
      alwaysAllowedTools: [],
      ...(row.controller.externalParent ? { externalParent: row.controller.externalParent } : {}),
    }
  }

  private requireRow(sessionId: string): RemoteControlledSessionRow {
    const row = this.deps.store.get(sessionId)
    if (!row) throw notFound()
    return row
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
    this.deps.events.appendSession({
      sessionId,
      eventType: SESSION_DURABLE_EVENT.created,
      payload: { projectId: input.projectId, harnessId: input.harnessId ?? 'claude', title: input.title ?? null },
    })
    return this.record(this.requireRow(sessionId))
  }

  get(sessionId: string): NodeSessionRecord | null {
    const row = this.deps.store.get(sessionId)
    return row ? this.record(row) : null
  }

  list(projectId?: string, options?: { limit?: number; offset?: number }): NodeSessionRecord[] {
    const rows = this.deps.store.list(projectId)
    const offset = options?.offset ?? 0
    const page = options?.limit != null ? rows.slice(offset, offset + options.limit) : rows.slice(offset)
    return page.map((row) => this.record(row))
  }

  patchSettings(sessionId: string, patch: NodeSessionSettings): NodeSessionRecord {
    const row = this.requireRow(sessionId)
    const pick = (value: string | null | undefined, current: string | null | undefined) => (value === undefined ? current : value)
    const controller: RemoteControllerRecord = {
      ...row.controller,
      permissionMode: pick(patch.permissionMode, row.controller.permissionMode),
      sandboxMode: pick(patch.sandboxMode, row.controller.sandboxMode),
      model: pick(patch.model, row.controller.model),
      effort: pick(patch.effort, row.controller.effort),
      apiProviderId: pick(patch.apiProviderId, row.controller.apiProviderId),
    }
    this.deps.store.setController(sessionId, controller)
    const live = this.deps.sessions.getSession(sessionId)
    if (live) void this.applySettings(live, controller)
    return this.record(this.requireRow(sessionId))
  }

  /** Bring a live session to the stored launch settings before it runs a turn. */
  private async applySettings(session: Session, settings: RemoteControllerRecord): Promise<void> {
    try {
      if (settings.permissionMode && settings.permissionMode !== session.getCurrentPermissionMode()) {
        await session.setPermissionMode(settings.permissionMode as PermissionMode)
      }
      if (settings.sandboxMode) await session.setSandboxMode(settings.sandboxMode as SandboxMode)
      // Only an explicit key: without one the session follows this desktop's binding.
      if (settings.apiProviderId && settings.apiProviderId !== session.getApiProviderId()) {
        session.setApiProviderId(settings.apiProviderId)
      }
    } catch (err) {
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
    this.requireRow(sessionId)
    const live = this.deps.sessions.getSession(sessionId)
    if (live) live.setTitle(title, source)
    else this.deps.store.rename(sessionId, title, source)
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
    const session = this.live(row)
    await this.applySettings(session, {
      ...row.controller,
      permissionMode: input.permissionMode ?? row.controller.permissionMode,
      sandboxMode: input.sandboxMode ?? row.controller.sandboxMode,
      apiProviderId: input.apiProviderId ?? row.controller.apiProviderId,
    })
    const request: SendMessageRequest = {
      content: input.text,
      ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort as EffortLevel } : {}),
      ...(input.images?.length
        ? { images: input.images.map((image) => ({ mimeType: image.mimeType, base64: image.base64, name: image.name ?? 'Attachment', ...(image.id ? { id: image.id } : {}) })) }
        : {}),
      ...(input.additionalDirectories?.length ? { additionalDirs: input.additionalDirectories } : {}),
      ...(input.userMessageContent ? { userMessageContent: input.userMessageContent } : {}),
      ...(input.contexts ? { contexts: input.contexts } : {}),
      ...(input.ultracode !== undefined ? { ultracode: input.ultracode } : {}),
      // A launch task from the controller's agent reads as one here, named after that device.
      ...(input.collaboration
        ? {
            source: 'collaboration' as const,
            collaboration: {
              kind: 'initial_task' as const,
              direction: 'inbound' as const,
              ...(row.controller.label ? { fromSessionTitle: row.controller.label } : {}),
            },
          }
        : {}),
    }
    // Answer once the turn is admitted; the rest streams through session.events.
    await new Promise<void>((resolve, reject) => {
      session.send(request, { providerOrigin: 'remote', onAccepted: () => resolve() }).then(() => resolve(), reject)
    })
    return this.record(this.requireRow(input.sessionId))
  }

  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void {
    this.requireRow(sessionId)
    this.assertLease(sessionId, client.clientSessionId, leaseId, generation)
    void this.deps.sessions.getSession(sessionId)?.interrupt()
  }

  private liveForResponse(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): Session {
    this.requireRow(sessionId)
    this.assertLease(sessionId, client.clientSessionId, leaseId, generation)
    const session = this.deps.sessions.getSession(sessionId)
    if (!session) throw Object.assign(new Error('no pending interaction'), { code: 'failed_precondition' })
    return session
  }

  respondPermission(input: Parameters<SessionHostPort['respondPermission']>[0]): void {
    const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
    const allow = input.decision === 'allow' || input.decision === 'allow_always'
    const handled = session.respondToPermission(
      input.interactionId,
      allow,
      input.decision === 'allow_always',
      undefined,
      undefined,
      input.cancel ? 'cancel' : undefined,
      input.formAnswers,
    )
    if (!handled) throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
  }

  respondQuestion(input: Parameters<SessionHostPort['respondQuestion']>[0]): void {
    const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
    session.respondToQuestion(input.interactionId, (input.answers ?? {}) as Record<string, string>)
  }

  respondPlan(input: Parameters<SessionHostPort['respondPlan']>[0]): void {
    const session = this.liveForResponse(input.sessionId, input.client, input.leaseId, input.generation)
    const feedback = typeof input.options?.feedback === 'string' ? input.options.feedback : undefined
    session.respondToPlanApproval(input.interactionId, input.decision === 'approve', feedback)
  }

  async modUi(): Promise<unknown> {
    throw unsupportedMethodError('session.modUi')
  }

  snapshotSequence(): string {
    return this.deps.events.headSequence()
  }

  listEventsAfter(afterSequence: string): EnvironmentEventEnvelope[] {
    return this.deps.events.listAfter(afterSequence)
  }

  onEventsAppended(listener: () => void): () => void {
    return this.deps.events.onAppend(listener)
  }

  listMessages(input: Parameters<SessionHostPort['listMessages']>[0]): ReturnType<SessionHostPort['listMessages']> {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireRow(sessionId)
    // Same end-cursor paging as the CLI node's catalog, read from the desktop transcript.
    const cursor = input.cursor == null ? undefined : Number(input.cursor)
    const page = this.deps.store.loadMessages(sessionId, input.limit ?? 50, Number.isFinite(cursor) ? cursor : undefined)
    const start = page.cursor ?? 0
    return {
      sessionId,
      messages: page.messages.map((message, i) => catalogBlock(message, start + i)),
      cursor: page.cursor === null ? null : String(page.cursor),
      hasMore: page.hasMore,
    }
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
    session.release(nodeControllerDeviceId(row.controller.clientSessionId))
    session.emitHostEvent({ type: 'remote_control_changed', released: true })
  }

  admitControl(sessionId: string, controllerClientSessionId: string, opts: { reclaim: boolean }): void {
    const row = this.deps.store.get(sessionId)
    if (!row?.controller.released) return
    if (!opts.reclaim) throw controlReleasedError()
    const controller: RemoteControllerRecord = { ...row.controller, released: false }
    this.deps.store.setController(sessionId, controller)
    const session = this.live({ ...row, controller })
    this.claim(session, row.controller.clientSessionId)
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
    const live = this.deps.sessions.getSession(sessionId)
    if (live && !row.controller.released) {
      live.release(nodeControllerDeviceId(row.controller.clientSessionId), 'self_switch')
      this.claim(live, controllerClientSessionId)
    }
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
