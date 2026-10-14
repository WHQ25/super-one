import { randomUUID } from 'node:crypto'
import {
  CONTROL_HELD_REASON,
  CONTROL_RELEASED_REASON,
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  SESSION_DURABLE_EVENT,
  type ControlLease,
  type EnvironmentEventEnvelope,
  type HostActionTerminalResult,
  type SessionControlHolder,
} from '@superone/shared/environment'
import type {
  AgentEvent,
  PermissionMode,
  SandboxMode,
  ScheduledSend,
  ScheduledSendPatch,
  SendMessageRequest,
  SessionForkRequest,
  SessionForkResult,
  SideChatStartResult,
} from '@superone/shared/agent-types'
import type { ControlLeasePort, DraftsPort, McpAppsPort, SessionHostPort } from '@superone/runtime/server'
import type { ControlLeaseService } from '@superone/runtime/lease'
import type { NodeSessionRecord } from '@superone/runtime/session'
import { unsupportedMethodError } from '@superone/runtime/server'
import {
  ArtifactWakes,
  HostActionChannel,
  type HostActionStore,
  type NodeSessionSettings,
} from '@superone/runtime/session'
import type { McpAppResourceStore } from '@superone/shared/mcp-app-resource'
import { messageText } from '@superone/shared/node-message-catalog'
import type { SessionListControl } from '@superone/shared/environment/session-operations'
import { DESKTOP_HOST_ACTION_TOOL_GROUPS, DesktopSessionReads, type DesktopSessionReadsDeps } from './desktop-session-reads'
import type { DesktopSessionRow, RemoteControllerRecord } from '../db-remote-controlled-sessions'
import type { Session, SessionCreateOptions } from '../session/types'
import log from '../logger'
import { admitDesktopSessionSend, applyDesktopSessionSettings, desktopSendRequest, respondDesktopPermission, respondDesktopQuestion, respondDesktopPlan } from './desktop-session-mutations'
import { createDesktopSession } from './desktop-session-create'
import { currentControlScope, isControllerClient, runFencedSessionControl, runHostReaction } from '../session/control-context'
import { holderClientOf } from '../session/session-lease'
import { enqueueSessionQueueOp } from '../session/session-queue'
import { worktreeExists } from '../git/worktree-alive'
import { createDesktopMcpAppsPort } from './desktop-mcp-apps-port'

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

/** Desktop persistence edits, injected alongside the rows clients read. */
export interface DesktopSessionEdits {
  create(input: { sessionId: string; projectPath: string; cwd: string; title?: string; providerId?: string }): void
  /** Mark a session as started by a controller, with its launch settings (`sessions.remote_controller_json`). */
  setController(sessionId: string, controller: RemoteControllerRecord, providerId?: string): boolean
  rename(sessionId: string, title: string, source: 'user' | 'agent'): void
  tags(sessionId: string, tags: string[]): void
  flags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }): void
  remove(sessionId: string): void
  close(sessionId: string): Promise<void>
  fork?(input: SessionForkRequest, assertControl: () => void): Promise<SessionForkResult>
}

export interface DesktopSessionHostDeps extends DesktopSessionReadsDeps<DesktopSessionRow> {
  leases: ControlLeasePort & Pick<ControlLeaseService, 'get'>
  /** Durable Host Actions this desktop's sessions ask their controller to run. */
  hostActions: HostActionStore
  projectPath(projectId: string): string | null
  /** The project a live session without a row (a side chat) belongs to. */
  projectId?(projectPath: string): string | null
  /** Pairing label of a controller, for the "started from" badge. */
  controllerLabel(clientSessionId: string): string | null
  /** Who holds a lease of this desktop, named (`controlHolderOf`). */
  controlHolder(lease: ControlLease): SessionControlHolder
  /** Whether a controller's pairing still admits it (not revoked or suspended). */
  controllerActive(clientSessionId: string): boolean
  edits: DesktopSessionEdits
  drafts?: DraftsPort
  sideChats?: {
    start(parentSessionId: string, assertControl: () => void): Promise<SideChatStartResult>
    close(sessionId: string): Promise<boolean>
  }
  scheduledSends?: {
    get(sessionId: string): ScheduledSend | null
    set(sessionId: string, patch: ScheduledSendPatch): ScheduledSend | null
    clear(sessionId: string): void
    list(): ScheduledSend[]
  }
  /** The window's MCP App HTML store (`mcp-apps/resource-store.ts`). */
  mcpAppResources?: () => McpAppResourceStore
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

/** The refusal a controller gets while someone else drives the session here. */
function controlHeldError(holder: SessionControlHolder): Error {
  return Object.assign(new Error(holder.kind === 'window'
    ? 'this computer is using the session; take it over to control it'
    : 'another device is controlling this session'), {
    code: 'failed_precondition',
    details: { reason: CONTROL_HELD_REASON, holder },
  })
}

/** A controller's launch settings after `patch`; absent fields keep their stored value. */
function withLaunchSettings(controller: RemoteControllerRecord, patch: NodeSessionSettings): RemoteControllerRecord {
  const pick = (value: string | null | undefined, current: string | null | undefined) => (value === undefined ? current : value)
  return {
    ...controller,
    permissionMode: pick(patch.permissionMode, controller.permissionMode),
    sandboxMode: pick(patch.sandboxMode, controller.sandboxMode),
    model: pick(patch.model, controller.model),
    effort: pick(patch.effort, controller.effort),
    apiProviderId: pick(patch.apiProviderId, controller.apiProviderId),
    mode: pick(patch.mode, controller.mode),
    agentPreset: pick(patch.agentPreset, controller.agentPreset),
    additionalDirectories: patch.additionalDirectories === undefined ? controller.additionalDirectories : patch.additionalDirectories,
  }
}

const refuse = (method: string) => () => { throw unsupportedMethodError(method) }

/**
 * `session.*` on the desktop, for every client — its window, its phones and
 * controller desktops: every session of this desktop, fenced by the domain's
 * leases, with events from the durable node event log so a client resumes by
 * sequence across reconnects and restarts of this app. A session a controller
 * starts here is stored as an ordinary desktop session marked with its
 * controller: the controller's launch settings, takeback by this desktop's
 * user, and the Host Actions its collaboration child asks of the controller.
 */
export class DesktopSessionHost extends DesktopSessionReads<DesktopSessionRow> implements SessionHostPort {
  /** Live Session objects this host watches for their controller (a resume makes a new one). */
  private readonly watched = new WeakSet<Session>()
  /** Event subscriptions on adopted sessions, dropped when the host stops. */
  private readonly sessionListeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private readonly hostActions: HostActionChannel
  private readonly artifactWakes: ArtifactWakes
  /** MCP App state, resources and provider calls of every session here (`mcpApps.*`). */
  readonly mcpApps: McpAppsPort

  constructor(private readonly deps: DesktopSessionHostDeps) {
    super(deps)
    this.artifactWakes = new ArtifactWakes(deps.hostActions)
    this.mcpApps = createDesktopMcpAppsPort({
      session: (sessionId) => this.live(sessionId),
      projectId: (sessionId) => this.requireRow(sessionId).projectId,
      resources: deps.mcpAppResources,
    })
    this.hostActions = new HostActionChannel({
      store: deps.hostActions,
      session: (sessionId) => {
        const row = deps.rows.get(sessionId)
        if (!row) return null
        const activity = deps.sessions.getSession(sessionId)?.activityStatus()
        return {
          controllerClientSessionId: row.controller?.clientSessionId ?? null,
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

  get unservedMethods(): ReadonlySet<string> {
    return new Set(this.deps.edits.fork ? [] : ['session.fork'])
  }

  get servedOperations(): ReadonlySet<string> {
    return new Set(['session.connection.reconnect', 'session.inbox.list', 'session.inbox.cancel', 'session.inbox.update', 'session.contextUsage', 'session.mcpStatus', 'session.mcpAuthenticate', 'session.refreshResources', 'session.stopTask', 'session.startQueued', 'session.reset', 'session.rewind', 'session.previewRewind', 'session.truncateAtCheckpoint',
      ...(this.deps.sideChats ? ['session.sideChatStart', 'session.sideChatClose'] : []),
      ...(this.deps.scheduledSends ? ['session.scheduledSend.get', 'session.scheduledSend.set', 'session.scheduledSend.clear', 'sessionList.scheduledSends'] : []),
      'sessionList.deleteOlderThan',
      'session.reportWorktreeRemoved',
      'session.forceRecover',
    ])
  }

  /** The controllers can no longer reach this desktop: every Host Action waiting on one is cancelled. */
  cancelHostActions(reason: string): void {
    this.hostActions.cancelWaiting(reason)
  }

  /**
   * The host stops serving: no new Host Actions, and every one in flight is
   * cancelled and answered so the child's tool call returns instead of
   * waiting on a controller that can no longer reach it. Must run before the
   * node database closes.
   */
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
    return this.deps.rows.get(sessionId)?.controller?.externalParent ?? null
  }

  /** A controller's session: its controller holds the lease again, and its Host Actions end with the turn. */
  private adopt(session: Session): void {
    if (this.watched.has(session)) return
    const controller = this.deps.rows.get(session.id)?.controller
    if (!controller) return
    this.watched.add(session)
    if (!controller.released) this.restoreControl(session, controller.clientSessionId)
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
    // A controller removed or suspended while this desktop was down gets nothing back.
    if (!this.deps.controllerActive(clientSessionId)) return
    try {
      this.deps.leases.acquire({ resource: { environmentId: this.deps.environmentId, sessionId: session.id }, holderClientId: clientSessionId, ttlMs: 60_000 })
    } catch (err) {
      // Another device (a phone) is already attached; the lease still gates the node surface.
      log.warn('[node-host] controller claim skipped sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
    }
  }

  /** The session's controller record when `clientSessionId` is a controller desktop; a taken-back session refuses it. */
  private controllerFor(row: DesktopSessionRow, clientSessionId: string): RemoteControllerRecord | null {
    if (!row.controller || !isControllerClient(clientSessionId)) return null
    if (row.controller.released) throw controlReleasedError()
    return row.controller
  }

  /**
   * A live session without a row is served while it runs: a side chat, which
   * never writes one, and a draft's prewarmed runtime, which its first message
   * stores. Lists show neither.
   */
  protected override row(sessionId: string): DesktopSessionRow | null {
    const stored = super.row(sessionId)
    if (stored) return stored
    const live = this.deps.sessions.getSession(sessionId)
    if (!live) return null
    const projectId = this.deps.projectId?.(live.projectPath)
    if (!projectId) return null
    const { harnessId, providerId, providerSessionId, cwd } = live.snapshot
    const now = Date.now()
    return {
      sessionId, projectId, projectPath: live.projectPath, title: null, harnessId, providerId,
      providerSessionId: providerSessionId ?? null, worktreePath: cwd !== live.projectPath ? cwd : null,
      isPinned: false, isHidden: live.ephemeral === true, isUserRenamed: false, tags: [], createdAt: now, updatedAt: now, controller: null,
    }
  }

  /** The live session, resumed with its controller's launch settings after a dispose or restart. */
  private live(sessionId: string): Session {
    const row = this.requireRow(sessionId)
    const existing = this.deps.sessions.getSession(sessionId)
    if (existing) return existing
    const session = this.deps.sessions.resumeSession(sessionId, {
      permissionMode: (row.controller?.permissionMode ?? undefined) as PermissionMode | undefined,
      sandboxMode: (row.controller?.sandboxMode ?? undefined) as SandboxMode | undefined,
      passive: true,
    })
    this.adopt(session)
    return session
  }

  private mutation(sessionId: string): Session {
    const session = this.live(sessionId)
    session.lease.assertMutation()
    return session
  }

  async callOperation(sessionId: string, method: string, input: Record<string, unknown>): Promise<unknown> {
    if (method === 'session.scheduledSend.get') return this.deps.scheduledSends!.get(sessionId)
    if (method === 'session.contextUsage') return this.deps.sessions.getSession(sessionId)?.getContextUsage() ?? null
    if (method === 'session.mcpStatus') return this.deps.sessions.getSession(sessionId)?.getMcpServerStatus() ?? []
    if (method === 'session.connection.reconnect') return { ok: await (this.deps.sessions.getSession(sessionId)?.reconnect?.() ?? false) }
    if (method === 'session.inbox.list') return this.deps.sessions.getSession(sessionId)?.listInbox?.() ?? []
    const session = method === 'session.previewRewind' ? this.live(sessionId) : this.mutation(sessionId)
    const checkpointId = input.checkpointId as string
    switch (method) {
      case 'session.forceRecover': {
        const { harnessId, providerSessionId } = session.snapshot
        if (harnessId !== 'cursor' || providerSessionId?.startsWith('bc-') || !session.forceRecoverRun) throw Object.assign(new Error('Force recover is only available for Cursor local agents'), { code: 'unsupported' })
        await session.forceRecoverRun(input.message as string | undefined)
        return { ok: true }
      }
      case 'session.reportWorktreeRemoved': {
        const { worktreePath, projectPath } = session.snapshot
        if (worktreePath && !worktreeExists(worktreePath, projectPath)) await session.markWorktreeRemoved()
        return null
      }
      case 'session.scheduledSend.set': return this.deps.scheduledSends!.set(sessionId, input.patch as ScheduledSendPatch)
      case 'session.scheduledSend.clear': this.deps.scheduledSends!.clear(sessionId); return null
      case 'session.sideChatStart': return this.deps.sideChats!.start(sessionId, () => session.lease.assertMutation())
      case 'session.sideChatClose': return this.deps.sideChats!.close(sessionId)
      case 'session.mcpAuthenticate': return session.authenticateMcp(input.serverName as string)
      case 'session.refreshResources': return session.refreshResources?.() ?? null
      case 'session.inbox.cancel':
        if (!session.cancelInbox) throw new Error('Native pending input is unavailable')
        await enqueueSessionQueueOp(sessionId, () => session.cancelInbox!(input.inboxId as string))
        return { ok: true }
      case 'session.inbox.update':
        if (!session.updateInbox) throw new Error('Native pending input is unavailable')
        await enqueueSessionQueueOp(sessionId, () => session.updateInbox!(input.inboxId as string, input.delivery as 'steer' | 'queue'))
        return { ok: true }
      case 'session.stopTask': await session.dispatchBackendCommand({ kind: 'claude.stop_task', taskId: input.taskId as string }); return true
      case 'session.startQueued': return enqueueSessionQueueOp(sessionId, () => { session.lease.assertMutation(); return session.startQueuedMessages() })
      case 'session.reset': {
        const nextId = input.newSessionId as string | undefined
        if (nextId && this.deps.sessions.getSession(nextId)) throw Object.assign(new Error('Session id already active'), { code: 'conflict' })
        const { projectPath, providerId, harnessId } = session.snapshot
        const { readDefaultSessionPrefs } = await import('../session/session-preferences')
        session.lease.assertMutation()
        await this.deps.sessions.disposeSession(sessionId)
        if (!nextId) return null
        const fresh = this.deps.sessions.createSession({ projectPath, providerId, id: nextId, ...readDefaultSessionPrefs(harnessId) })
        fresh.lease.grantCreatedSession()
        return { permissionMode: fresh.getCurrentPermissionMode(), sandboxInfo: fresh.getCurrentSandboxInfo() }
      }
      case 'session.previewRewind': return session.rewindFiles(checkpointId, { dryRun: true })
      case 'session.rewind':
        return input.mode === 'conversation' ? session.rewindConversation(checkpointId)
          : session.rewindFiles(checkpointId, { includeConversation: input.mode === 'code+chat' })
      case 'session.truncateAtCheckpoint': session.truncateMessagesAt(checkpointId); return true
      default: throw unsupportedMethodError(method)
    }
  }

  async callListOperation(method: string, input: Record<string, unknown>, clientSessionId: string): Promise<ScheduledSend[] | string[]> {
    if (method === 'sessionList.scheduledSends') return this.deps.scheduledSends!.list()
    if (method === 'sessionList.deleteOlderThan') {
      const cutoff = Date.parse(input.cutoffDate as string)
      const candidates = this.deps.rows.list(input.projectId as string).filter(row => !row.isPinned && row.updatedAt < cutoff)
      const controls = new Map((input.controls as SessionListControl[]).map(control => [control.sessionId, control]))
      if (candidates.some(row => !controls.has(row.sessionId))) throw Object.assign(new Error('Session list changed; read it again before deleting'), { code: 'failed_precondition' })
      const deleted: string[] = []
      for (const row of candidates) {
        const latest = this.deps.rows.get(row.sessionId)
        if (!latest || latest.isPinned || latest.updatedAt >= cutoff) continue
        await runFencedSessionControl(row.sessionId, clientSessionId, controls.get(row.sessionId)!, () => this.remove(row.sessionId))
        deleted.push(row.sessionId)
      }
      return deleted
    }
    throw unsupportedMethodError(method)
  }

  create(input: Parameters<SessionHostPort['create']>[0]) {
    const projectPath = this.deps.projectPath(input.projectId)
    if (!projectPath) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    const sessionId = randomUUID()
    const cwd = input.cwd ?? projectPath
    this.deps.edits.create({ sessionId, projectPath, cwd, title: input.title })
    const session = this.deps.sessions.createSession({ id: sessionId, projectPath, cwd,
      providerId: input.providerId ?? `${input.harnessId ?? 'claude'}-base`,
      apiProviderId: input.apiProviderId, title: input.title, systemPromptAppend: input.systemPromptAppend ?? undefined })
    session.lease.grantCreatedSession()
    return this.record(this.requireRow(sessionId))
  }

  async createOnHost(input: Parameters<NonNullable<SessionHostPort['createOnHost']>>[0], options: Parameters<NonNullable<SessionHostPort['createOnHost']>>[1]) {
    const clientSessionId = input.controllerClientSessionId
    const controller: RemoteControllerRecord | null = clientSessionId && isControllerClient(clientSessionId)
      ? withLaunchSettings({
        clientSessionId,
        label: this.deps.controllerLabel(clientSessionId),
        ...(input.apiProviderId ? { apiProviderId: input.apiProviderId } : {}),
        ...(input.systemPromptAppend ? { systemPromptAppend: input.systemPromptAppend } : {}),
        ...(input.externalParent ? { externalParent: { sessionId: input.externalParent.sessionId } } : {}),
      }, options.settings)
      : null
    const session = await createDesktopSession(this.deps, input, options, controller)
    if (controller) {
      this.adopt(session)
      this.deps.events.appendSession({
        sessionId: session.id,
        eventType: SESSION_DURABLE_EVENT.created,
        payload: { projectId: input.projectId, harnessId: input.harnessId ?? 'claude', title: input.title ?? null },
      })
    }
    return this.record(this.requireRow(session.id))
  }

  async setCwd(sessionId: string, cwd: string | null) {
    const session = this.mutation(sessionId)
    await session.applyWorktreeSelection(cwd ?? this.requireRow(sessionId).projectPath)
    return this.record(this.requireRow(sessionId))
  }

  async patchSettings(sessionId: string, patch: NodeSessionSettings) {
    const live = this.mutation(sessionId)
    await applyDesktopSessionSettings(live, patch)
    // A controller's session keeps its launch settings for the next cold resume.
    const controller = this.requireRow(sessionId).controller
    if (controller) {
      live.lease.assertMutation()
      this.deps.edits.setController(sessionId, withLaunchSettings(controller, patch))
    }
    return this.record(this.requireRow(sessionId))
  }

  validateSettings(): void { /* Desktop Session applies native harness selections. */ }

  /** Bring a live session to its controller's launch settings before it runs a turn. */
  private async applyLaunchSettings(session: Session, settings: RemoteControllerRecord): Promise<void> {
    try {
      await applyDesktopSessionSettings(session, settings)
    } catch (err) {
      if (['failed_precondition', 'forbidden', 'lease_stale', 'lease_required'].includes((err as { code?: string }).code ?? '')) throw err
      log.warn('[node-host] applying settings failed sid=%s: %s', session.id, err instanceof Error ? err.message : String(err))
    }
  }

  // Title, tags and sidebar flags are the session's catalog entry, not its
  // runtime: any client may edit them, and a cold session stays cold.
  rename(sessionId: string, title: string, source: 'user' | 'agent' = 'user') {
    this.requireRow(sessionId)
    const live = this.deps.sessions.getSession(sessionId)
    runHostReaction(() => live?.setTitle(title, source))
    this.deps.edits.rename(sessionId, title, source)
    return this.record(this.requireRow(sessionId))
  }

  setTags(sessionId: string, tags: string[]) {
    this.requireRow(sessionId)
    this.deps.edits.tags(sessionId, tags)
    return this.record(this.requireRow(sessionId))
  }

  setUiFlags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }) {
    this.requireRow(sessionId)
    this.deps.edits.flags(sessionId, flags)
    return this.record(this.requireRow(sessionId))
  }

  async close(sessionId: string): Promise<void> {
    this.mutation(sessionId)
    await this.deps.edits.close(sessionId)
  }

  async remove(sessionId: string) {
    this.mutation(sessionId)
    const record = this.record(this.requireRow(sessionId))
    await this.deps.edits.close(sessionId)
    // Closing ends the resource lease; removal is the admitted close's final step.
    this.deps.edits.remove(sessionId)
    return record
  }

  async send(input: Parameters<SessionHostPort['send']>[0]) {
    const controller = this.controllerFor(this.requireRow(input.sessionId), input.client.clientSessionId)
    return runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, async () => {
      const session = this.mutation(input.sessionId)
      const sendRequest = desktopSendRequest(input, session.snapshot.harnessId)
      const overrides = {
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
        ...(input.apiProviderId ? { apiProviderId: input.apiProviderId } : {}),
      }
      if (controller) await this.applyLaunchSettings(session, { ...controller, ...overrides })
      else await applyDesktopSessionSettings(session, overrides)
      const request: SendMessageRequest = {
        ...sendRequest,
        // A controller's agent hands its task over as a task from that desktop.
        ...(controller && input.collaboration ? {
          source: 'collaboration' as const,
          collaboration: {
            kind: 'initial_task' as const, direction: 'inbound' as const,
            ...(controller.label ? { fromSessionTitle: controller.label } : {}),
          },
        } : {}),
      }
      await admitDesktopSessionSend(session, request, input)
      return this.record(this.requireRow(input.sessionId))
    })
  }

  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void {
    this.controllerFor(this.requireRow(sessionId), client.clientSessionId)
    runFencedSessionControl(sessionId, client.clientSessionId, { leaseId, generation }, () => { void this.mutation(sessionId).interrupt() })
  }

  /** The live session a client answers a prompt of. */
  private responding(input: { sessionId: string; client: { clientSessionId: string } }): Session {
    this.controllerFor(this.requireRow(input.sessionId), input.client.clientSessionId)
    return this.mutation(input.sessionId)
  }

  respondPermission(input: Parameters<SessionHostPort['respondPermission']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopPermission(this.responding(input), input))
  }
  respondQuestion(input: Parameters<SessionHostPort['respondQuestion']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopQuestion(this.responding(input), input))
  }
  async respondPlan(input: Parameters<SessionHostPort['respondPlan']>[0]): Promise<void> {
    await runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopPlan(this.responding(input), input))
  }
  async modUi(input: Parameters<SessionHostPort['modUi']>[0]) {
    return this.live(input.sessionId).modUi(input.op, input.request)
  }

  /**
   * This desktop's user takes a controller's session back, as Disconnect does
   * for a phone: the controller's claim and lease end and the composer here
   * opens. The controller keeps the session and watches until it reconnects.
   */
  releaseControl(sessionId: string): void {
    const row = this.requireRow(sessionId)
    if (!row.controller || row.controller.released) return
    this.deps.edits.setController(sessionId, { ...row.controller, released: true })
    this.deps.leases.revoke({ environmentId: this.deps.environmentId, sessionId })
    this.live(sessionId).emitHostEvent({ type: 'remote_control_changed', released: true })
  }

  /**
   * A controller acquiring a session taken back from it drives it again only
   * when it reclaims it on purpose; the reclaim lands once its lease is granted.
   * Nor does it take a session from whoever drives it here: a phone or another
   * controller refuses it, and this desktop's window yields only to the user's
   * explicit Take over (`reclaim`), or to a phone the controller acquires for,
   * as it yields to this desktop's own phones. The refusal names the holder.
   */
  admitControl(sessionId: string, controllerClientSessionId: string, opts: { reclaim: boolean; delegate?: string }): (() => void) | void {
    const controller = this.requireRow(sessionId).controller
    const isController = isControllerClient(controllerClientSessionId)
    const released = !!controller?.released && isController
    if (released && !opts.reclaim) throw controlReleasedError()
    const lease = isController ? this.deps.leases.get({ environmentId: this.deps.environmentId, sessionId }) : null
    if (lease && lease.holderClientId !== controllerClientSessionId) {
      const holder = this.deps.controlHolder(lease)
      if (holder.kind !== 'window' || !(opts.reclaim || opts.delegate?.startsWith('phone:'))) throw controlHeldError(holder)
    }
    if (!released) return
    return () => {
      this.deps.edits.setController(sessionId, { ...controller, released: false })
      this.live(sessionId).emitHostEvent({ type: 'remote_control_changed', released: false })
    }
  }

  /**
   * Record who drives a session now on its stream, so a controller following
   * it shows that before it asks for control. Each reader sees itself as
   * nobody (`viewEvent`).
   */
  publishControlHolder(sessionId: string, lease: ControlLease | null): void {
    if (!this.row(sessionId)) return
    const event: AgentEvent = { type: 'session_control_holder', holder: lease ? this.deps.controlHolder(lease) : null }
    this.deps.events.appendSession({
      sessionId,
      eventType: SESSION_DURABLE_EVENT.agentEvent,
      payload: { event, ...(lease ? { holderClient: holderClientOf(lease, this.deps.environmentId) } : {}) },
    })
  }

  override viewEvent(envelope: EnvironmentEventEnvelope, reader?: { clientSessionId: string }): EnvironmentEventEnvelope {
    const payload = envelope.payload as { event?: AgentEvent; holderClient?: string } | null
    if (envelope.eventType !== SESSION_DURABLE_EVENT.agentEvent || payload?.event?.type !== 'session_control_holder') return envelope
    const self = !!payload.holderClient && payload.holderClient === reader?.clientSessionId
    return { ...envelope, payload: { event: self ? { ...payload.event, holder: null } : payload.event } }
  }

  /** A session's record as the client reading it sees it: who else drives it now, if anyone. */
  protected override record(row: DesktopSessionRow): NodeSessionRecord {
    const record = super.record(row)
    const lease = this.deps.leases.get({ environmentId: this.deps.environmentId, sessionId: row.sessionId })
    if (!lease || holderClientOf(lease, this.deps.environmentId) === currentControlScope()?.clientSessionId) return record
    return { ...record, controlHolder: this.deps.controlHolder(lease) }
  }

  async forkOnHost(input: Parameters<NonNullable<SessionHostPort['forkOnHost']>>[0]) {
    return runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, async () => {
      const fork = this.deps.edits.fork
      if (!fork) throw unsupportedMethodError('session.fork')
      const source = this.mutation(input.sessionId)
      const result = await fork({ sessionId: input.sessionId, mode: input.mode, carryLocalChanges: input.carryLocalChanges, forkFromMessageId: input.forkFromMessageId }, () => source.lease.assertMutation())
      return result.ok ? { ...result, session: this.record(this.requireRow(result.sessionId)) } : result
    })
  }

  /**
   * A controller that acquires a controller's session (re-paired, or another
   * desktop) becomes the one its Host Actions go to. Phones and this desktop's
   * window acquiring it, or any client acquiring this desktop's own session,
   * change neither its launch origin nor its Host Actions.
   */
  rebindHostActionController(sessionId: string, controllerClientSessionId: string): null {
    const row = this.requireRow(sessionId)
    if (!row.controller || !isControllerClient(controllerClientSessionId) || row.controller.clientSessionId === controllerClientSessionId) return null
    this.deps.edits.setController(sessionId, {
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

  /**
   * A controller's deferred artifact landed in this desktop's sync zone: wake
   * the session's agent once per notification, as the CLI node does. The
   * dispatcher built the text from files it holds; the wake is host work, not
   * the controller's turn, so it needs no lease. The answer comes once the
   * session admits the wake, so a wake that cannot land is retried and one
   * that starts a long turn does not hold the controller's call open.
   */
  async notifyArtifactsCompleted(input: Parameters<SessionHostPort['notifyArtifactsCompleted']>[0]): Promise<{ delivered: boolean }> {
    if (this.requireRow(input.sessionId).controller?.clientSessionId !== input.controllerClientSessionId) {
      throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
    }
    return this.artifactWakes.deliverOnce(input.sessionId, input.notificationId, () =>
      runHostReaction(() => this.live(input.sessionId).admitTaskNotification(input.text)))
  }

  fork = refuse('session.fork')
}
