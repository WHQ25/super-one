import { randomUUID } from 'node:crypto'
import type { SessionHostPort, DraftsPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import type { NodeSessionSettings } from '@superone/runtime/session'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { SessionForkRequest, SessionForkResult } from '@superone/shared/agent-types'
import { runFencedSessionControl } from '../session/control-context'
import { DesktopSessionReads, type DesktopSessionReadsDeps } from './desktop-session-reads'
import { admitDesktopSessionSend, applyDesktopSessionSettings, desktopSendRequest, respondDesktopPermission, respondDesktopQuestion, respondDesktopPlan } from './desktop-session-mutations'
import { createDesktopSession } from './desktop-session-create'

/** Desktop persistence edits, injected alongside the rows the phone reads. */
export interface LocalSessionEdits {
  create(input: { sessionId: string; projectPath: string; cwd: string; title?: string }): void
  rename(sessionId: string, title: string, source: 'user' | 'agent'): void
  tags(sessionId: string, tags: string[]): void
  flags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }): void
  remove(sessionId: string): void
  close(sessionId: string): Promise<void>
  fork?(input: SessionForkRequest, assertControl: () => void): Promise<SessionForkResult>
}

export interface LocalSessionHostDeps extends DesktopSessionReadsDeps<DesktopSessionRow> {
  projectPath(projectId: string): string | null
  edits?: LocalSessionEdits
  drafts?: DraftsPort
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

  private edits(): LocalSessionEdits {
    if (!this.deps.edits) throw unsupportedMethodError('session persistence edits')
    return this.deps.edits
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

  rename(sessionId: string, title: string, source: 'user' | 'agent' = 'user') {
    this.mutation(sessionId).setTitle(title, source)
    this.edits().rename(sessionId, title, source)
    return this.record(this.requireRow(sessionId))
  }

  setTags(sessionId: string, tags: string[]) {
    this.mutation(sessionId)
    this.edits().tags(sessionId, tags)
    return this.record(this.requireRow(sessionId))
  }

  setUiFlags(sessionId: string, flags: { isPinned?: boolean; isHidden?: boolean }) {
    this.mutation(sessionId)
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
