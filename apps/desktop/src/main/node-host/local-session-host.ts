import { enqueueSessionQueueOp } from '../session/session-queue'
import { randomUUID } from 'node:crypto'
import type { SessionHostPort, DraftsPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import type { NodeSessionSettings } from '@superone/runtime/session'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { SessionForkRequest, SessionForkResult, SideChatStartResult, ScheduledSend, ScheduledSendPatch } from '@superone/shared/agent-types'
import { runFencedSessionControl, runHostReaction } from '../session/control-context'
import { DesktopSessionReads, type DesktopSessionReadsDeps } from './desktop-session-reads'
import { admitDesktopSessionSend, applyDesktopSessionSettings, desktopSendRequest, respondDesktopPermission, respondDesktopQuestion, respondDesktopPlan } from './desktop-session-mutations'
import { createDesktopSession } from './desktop-session-create'
import type { SessionListControl } from '@superone/shared/environment/session-operations'
import { worktreeExists } from '../git/worktree-alive'

/** Desktop persistence edits, injected alongside the rows the phone reads. */
export interface LocalSessionEdits {
  create(input: { sessionId: string; projectPath: string; cwd: string; title?: string; providerId?: string }): void
  rename(sessionId: string, title: string, source: 'user' | 'agent'): void
  tags(sessionId: string, tags: string[]): void
  flags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }): void
  remove(sessionId: string): void
  close(sessionId: string): Promise<void>
  fork?(input: SessionForkRequest, assertControl: () => void): Promise<SessionForkResult>
}

export interface LocalSessionHostDeps extends DesktopSessionReadsDeps<DesktopSessionRow> {
  projectPath(projectId: string): string | null
  /** The project a live session without a row (a side chat) belongs to. */
  projectId?(projectPath: string): string | null
  edits?: LocalSessionEdits
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
}

/** Families with no local meaning; phones use the controller's Host Actions on routed sessions. */
export const LOCAL_SESSION_UNSERVED = new Set([
  'session.fork', 'session.hostActionsPoll', 'session.claimHostAction', 'session.respondHostAction',
  'session.renewHostActionClaim', 'session.notifyArtifactCompleted',
])

const refuse = (method: string) => () => { throw unsupportedMethodError(method) }

/** All desktop sessions, sharing the domain's fenced leases with IPC and controllers. */
export class LocalSessionHost extends DesktopSessionReads<DesktopSessionRow> implements SessionHostPort {
  constructor(private readonly deps: LocalSessionHostDeps) { super(deps) }
  protected override serves(): boolean { return true }
  dispose(): void { this.disposeReads() }
  get unservedMethods(): ReadonlySet<string> { return new Set([...LOCAL_SESSION_UNSERVED].filter(method => method !== 'session.fork' || !this.deps.edits?.fork)) }

  get servedOperations(): ReadonlySet<string> {
    return new Set(['session.connection.reconnect', 'session.inbox.list', 'session.inbox.cancel', 'session.inbox.update', 'session.contextUsage', 'session.mcpStatus', 'session.mcpAuthenticate', 'session.refreshResources', 'session.stopTask', 'session.startQueued', 'session.reset', 'session.rewind', 'session.previewRewind', 'session.truncateAtCheckpoint',
      ...(this.deps.sideChats ? ['session.sideChatStart', 'session.sideChatClose'] : []),
      ...(this.deps.scheduledSends ? ['session.scheduledSend.get', 'session.scheduledSend.set', 'session.scheduledSend.clear', 'sessionList.scheduledSends'] : []),
      ...(this.deps.edits ? ['sessionList.deleteOlderThan'] : []),
      'session.reportWorktreeRemoved',
      'session.forceRecover',
    ])
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

  private edits(): LocalSessionEdits {
    if (!this.deps.edits) throw unsupportedMethodError('session persistence edits')
    return this.deps.edits
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

  private live(sessionId: string): Session {
    this.requireRow(sessionId)
    return this.deps.sessions.getSession(sessionId) ?? this.deps.sessions.resumeSession(sessionId, { passive: true })
  }

  private mutation(sessionId: string): Session {
    const session = this.live(sessionId)
    session.lease.assertMutation()
    return session
  }

  create(input: Parameters<SessionHostPort['create']>[0]) {
    const projectPath = this.deps.projectPath(input.projectId)
    if (!projectPath) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    const sessionId = randomUUID()
    const cwd = input.cwd ?? projectPath
    this.edits().create({ sessionId, projectPath, cwd, title: input.title })
    const session = this.deps.sessions.createSession({ id: sessionId, projectPath, cwd,
      providerId: input.providerId ?? `${input.harnessId ?? 'claude'}-base`,
      apiProviderId: input.apiProviderId, title: input.title, systemPromptAppend: input.systemPromptAppend ?? undefined })
    session.lease.grantCreatedSession()
    return this.record(this.requireRow(sessionId))
  }

  async createOnHost(input: Parameters<NonNullable<SessionHostPort['createOnHost']>>[0], options: Parameters<NonNullable<SessionHostPort['createOnHost']>>[1]) {
    const session = await createDesktopSession(this.deps, input, options)
    return this.record(this.requireRow(session.id))
  }

  async setCwd(sessionId: string, cwd: string | null) {
    const session = this.mutation(sessionId)
    await session.applyWorktreeSelection(cwd ?? this.requireRow(sessionId).projectPath)
    return this.record(this.requireRow(sessionId))
  }

  async patchSettings(sessionId: string, patch: NodeSessionSettings) {
    await applyDesktopSessionSettings(this.mutation(sessionId), patch)
    return this.record(this.requireRow(sessionId))
  }

  validateSettings(): void { /* Desktop Session applies native harness selections. */ }

  // Title, tags and sidebar flags are the session's catalog entry, not its
  // runtime: any client may edit them, and a cold session stays cold.
  rename(sessionId: string, title: string, source: 'user' | 'agent' = 'user') {
    this.requireRow(sessionId)
    const live = this.deps.sessions.getSession(sessionId)
    runHostReaction(() => live?.setTitle(title, source))
    this.edits().rename(sessionId, title, source)
    return this.record(this.requireRow(sessionId))
  }

  setTags(sessionId: string, tags: string[]) {
    this.requireRow(sessionId)
    this.edits().tags(sessionId, tags)
    return this.record(this.requireRow(sessionId))
  }

  setUiFlags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }) {
    this.requireRow(sessionId)
    this.edits().flags(sessionId, flags)
    return this.record(this.requireRow(sessionId))
  }

  async close(sessionId: string): Promise<void> {
    this.mutation(sessionId)
    await this.edits().close(sessionId)
  }

  async remove(sessionId: string) {
    this.mutation(sessionId)
    const record = this.record(this.requireRow(sessionId))
    await this.edits().close(sessionId)
    // Closing ends the resource lease; removal is the admitted close's final step.
    this.edits().remove(sessionId)
    return record
  }

  async send(input: Parameters<SessionHostPort['send']>[0]) {
    return runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, async () => {
      const session = this.mutation(input.sessionId)
      const request = desktopSendRequest(input, session.snapshot.harnessId)
      await applyDesktopSessionSettings(session, {
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
        ...(input.apiProviderId ? { apiProviderId: input.apiProviderId } : {}),
      })
      await admitDesktopSessionSend(session, request, input)
      return this.record(this.requireRow(input.sessionId))
    })
  }

  interrupt(sessionId: string, client: { clientSessionId: string }, leaseId: string, generation: string): void {
    runFencedSessionControl(sessionId, client.clientSessionId, { leaseId, generation }, () => { void this.mutation(sessionId).interrupt() })
  }

  respondPermission(input: Parameters<SessionHostPort['respondPermission']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopPermission(this.mutation(input.sessionId), input))
  }
  respondQuestion(input: Parameters<SessionHostPort['respondQuestion']>[0]): void {
    runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopQuestion(this.mutation(input.sessionId), input))
  }
  async respondPlan(input: Parameters<SessionHostPort['respondPlan']>[0]): Promise<void> {
    await runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, () => respondDesktopPlan(this.mutation(input.sessionId), input))
  }
  async modUi(input: Parameters<SessionHostPort['modUi']>[0]) {
    return this.live(input.sessionId).modUi(input.op, input.request)
  }

  admitControl(sessionId: string): void { this.requireRow(sessionId) }

  async forkOnHost(input: Parameters<NonNullable<SessionHostPort['forkOnHost']>>[0]) {
    return runFencedSessionControl(input.sessionId, input.client.clientSessionId, input, async () => {
      const fork = this.edits().fork
      if (!fork) throw unsupportedMethodError('session.fork')
      const source = this.mutation(input.sessionId)
      const result = await fork({ sessionId: input.sessionId, mode: input.mode, carryLocalChanges: input.carryLocalChanges, forkFromMessageId: input.forkFromMessageId }, () => source.lease.assertMutation())
      return result.ok ? { ...result, session: this.record(this.requireRow(result.sessionId)) } : result
    })
  }

  // Acquiring an existing local session does not change its launch origin or Host Actions.
  rebindHostActionController(): null { return null }
  fork = refuse('session.fork')
  pollHostActions = async () => refuse('session.hostActionsPoll')()
  claimHostAction = refuse('session.claimHostAction')
  renewHostActionClaim = refuse('session.renewHostActionClaim')
  respondHostAction = refuse('session.respondHostAction')
  notifyArtifactsCompleted = async () => refuse('session.notifyArtifactCompleted')()
}
