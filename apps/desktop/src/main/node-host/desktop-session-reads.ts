import {
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  type EnvironmentEventEnvelope,
} from '@superone/shared/environment'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionHostPort } from '@superone/runtime/server'
import type { EventLog, NodeSessionRecord, PendingInteraction } from '@superone/runtime/session'
import { chatMessageToSessionMessageBlock } from '@superone/shared/node-message-catalog'
import { applyEventToSession, createDefaultChatCoreSession, type ChatCoreSession } from '@superone/chat-core'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { NodeHostSessionManager } from './desktop-session-host'
import type { AgentEvent } from '@superone/shared/agent-types'

/**
 * Host Action tool groups a controller runs for sessions served here. Only the
 * mailbox tools of a collaboration child whose parent is on the controller use
 * the channel today; the desktop runs every other tool itself.
 */
export const DESKTOP_HOST_ACTION_TOOL_GROUPS = [HOST_ACTION_TOOL_GROUPS.superone]

/** The desktop session rows a session host serves, and their stored transcripts. */
export interface DesktopSessionRows<Row extends DesktopSessionRow> {
  get(sessionId: string): Row | null
  list(projectId?: string): Row[]
  /** Persisted transcript page (desktop end-cursor pagination). */
  loadMessages(sessionId: string, limit: number, cursor?: number): { messages: ChatMessage[]; cursor: number | null; hasMore: boolean }
}

export interface DesktopSessionReadsDeps<Row extends DesktopSessionRow> {
  sessions: NodeHostSessionManager
  events: EventLog
  rows: DesktopSessionRows<Row>
}

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

export function notFound(): Error {
  return Object.assign(new Error('session not found'), { code: 'not_found' })
}

/**
 * The reading half of `session.*` on this desktop, over the sessions `rows`
 * serves: records, transcripts and the session's events from the domain log
 * (`SessionEventRecorder`), at the version the recorded events reached. The
 * desktop `Session` is the read model; a session not loaded reads from its
 * stored transcript.
 */
export abstract class DesktopSessionReads<Row extends DesktopSessionRow> implements Pick<SessionHostPort,
  'get' | 'list' | 'load' | 'messages' | 'listMessages' | 'snapshotSequence' | 'listEventsAfter' | 'streamEpoch'
  | 'streamingAfter' | 'streamingEvents' | 'onEventsAppended' | 'viewEvent'> {
  /** When each live prompt was first seen, so its `createdAt` is stable across reads. */
  private readonly promptSeenAt = new Map<string, number>()
  private readonly watchedPrompts = new WeakSet<Session>()
  private readonly promptListeners = new Set<() => void>()
  private readonly stopWatchingPrompts: () => void

  constructor(protected readonly reads: DesktopSessionReadsDeps<Row>) {
    this.stopWatchingPrompts = reads.sessions.onSession((session) => {
      if (this.watchedPrompts.has(session)) return
      this.watchedPrompts.add(session)
      this.promptListeners.add(session.on((event, replay) => {
        if (!replay && event.type === 'interaction_resolved') this.promptSeenAt.delete(event.requestId)
      }))
    })
  }

  protected disposeReads(): void {
    this.stopWatchingPrompts()
    for (const off of this.promptListeners) off()
    this.promptListeners.clear()
  }

  protected requireRow(sessionId: string): Row {
    const row = this.reads.rows.get(sessionId)
    if (!row) throw notFound()
    return row
  }

  /** The live session's open prompt (one at a time on the wire, as on the CLI node). */
  protected pendingInteraction(live: Session | null): PendingInteraction | null {
    for (const event of live?.getPendingInteractions() ?? []) {
      const id = 'request' in event && event.request && typeof event.request === 'object' ? (event.request as { requestId?: string }).requestId : undefined
      if (!id) continue
      if (!this.promptSeenAt.has(id)) this.promptSeenAt.set(id, Date.now())
      const pending = pendingInteractionOf(event, this.promptSeenAt.get(id)!)
      if (pending) return pending
    }
    return null
  }

  protected record(row: Row): NodeSessionRecord {
    const live = this.reads.sessions.getSession(row.sessionId)
    const activity = live?.activityStatus()
    const controller = row.controller
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
      // A controller's launch settings; this desktop's own sessions report what they run with now.
      permissionMode: controller ? controller.permissionMode ?? null : live?.getCurrentPermissionMode() ?? null,
      sandboxMode: controller?.sandboxMode ?? null,
      model: controller?.model ?? null,
      effort: controller?.effort ?? null,
      apiProviderId: controller ? controller.apiProviderId ?? null : live?.getApiProviderId() ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      isPinned: row.isPinned,
      isHidden: row.isHidden,
      isUserRenamed: row.isUserRenamed,
      tags: row.tags,
      controllerClientSessionId: controller?.clientSessionId ?? null,
      ...(controller?.released ? { controlReleased: true } : {}),
      hostActionCapabilityVersion: HOST_ACTION_CAPABILITY_VERSION,
      hostActionToolGroups: [...DESKTOP_HOST_ACTION_TOOL_GROUPS],
      alwaysAllowedTools: [],
      ...(controller?.externalParent ? { externalParent: controller.externalParent } : {}),
    }
  }

  get(sessionId: string): NodeSessionRecord | null {
    const row = this.reads.rows.get(sessionId)
    return row ? this.record(row) : null
  }

  list(projectId?: string, options?: { limit?: number; offset?: number }): NodeSessionRecord[] {
    const rows = this.reads.rows.list(projectId)
    const offset = options?.offset ?? 0
    const page = options?.limit != null ? rows.slice(offset, offset + options.limit) : rows.slice(offset)
    return page.map((row) => this.record(row))
  }

  /**
   * The live session's messages and prompts (its stored transcript when it is
   * not loaded), at the version its recorded events have reached.
   */
  load(input: Parameters<SessionHostPort['load']>[0]): ReturnType<SessionHostPort['load']> {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireRow(sessionId)
    const live = this.reads.sessions.getSession(sessionId)
    let state: ChatCoreSession = createDefaultChatCoreSession()
    for (const event of live?.getPendingInteractions() ?? []) state = { ...state, ...applyEventToSession(state, event) }
    const all = this.messages(sessionId)
    const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
    const end = Math.min(input.before ?? all.length, all.length)
    const start = Math.max(0, end - limit)
    const { messages: _messages, ...rest } = { ...state, status: live?.isStreaming() ? 'streaming' as const : 'idle' as const }
    const { events } = this.reads
    return {
      sessionId,
      state: rest as unknown as Record<string, unknown>,
      messages: all.slice(start, end),
      before: start > 0 ? start : null,
      cursor: { sequence: events.headSequence(), epoch: events.epoch, version: events.sessionVersion(sessionId) },
    }
  }

  messages(sessionId: string): ChatMessage[] {
    this.requireRow(sessionId)
    const live = this.reads.sessions.getSession(sessionId)
    return live ? [...live.snapshot.messages] : this.reads.rows.loadMessages(sessionId, Number.MAX_SAFE_INTEGER).messages
  }

  listMessages(input: Parameters<SessionHostPort['listMessages']>[0]): ReturnType<SessionHostPort['listMessages']> {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireRow(sessionId)
    // Same end-cursor paging as the CLI node's catalog, read from the desktop transcript.
    const cursor = input.cursor == null ? undefined : Number(input.cursor)
    const page = this.reads.rows.loadMessages(sessionId, input.limit ?? 50, Number.isFinite(cursor) ? cursor : undefined)
    const start = page.cursor ?? 0
    return {
      sessionId,
      messages: page.messages.map((message, i) => chatMessageToSessionMessageBlock(message, start + i)),
      cursor: page.cursor === null ? null : String(page.cursor),
      hasMore: page.hasMore,
    }
  }

  snapshotSequence(): string {
    return this.reads.events.headSequence()
  }

  /**
   * The log records every session of this desktop; a reader sees the sessions
   * `rows` serves. A page with none of them reads on, so an empty answer still
   * means the end of the log.
   */
  listEventsAfter(afterSequence: string): EnvironmentEventEnvelope[] {
    let cursor = afterSequence
    for (;;) {
      const page = this.reads.events.listAfter(cursor)
      if (page.length === 0) return []
      const visible = page.filter((envelope) => this.visible(envelope))
      if (visible.length > 0) return visible
      cursor = page.at(-1)!.sequence
    }
  }

  /** Whether this host serves `sessionId`; asked for every event read, so hosts answer it without a query when they can. */
  protected serves(sessionId: string): boolean {
    return this.reads.rows.get(sessionId) !== null
  }

  private visible(envelope: EnvironmentEventEnvelope): boolean {
    return envelope.aggregateType !== 'session' || this.serves(envelope.aggregateId)
  }

  streamEpoch(): string {
    return this.reads.events.epoch
  }

  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null {
    return this.serves(sessionId) ? this.reads.events.streamingAfter(sessionId, version) : []
  }

  streamingEvents(): EnvironmentEventEnvelope[] {
    return this.reads.events.streaming().filter((envelope) => this.visible(envelope))
  }

  onEventsAppended(listener: (envelope: EnvironmentEventEnvelope) => void): () => void {
    return this.reads.events.onAppend((envelope) => {
      if (this.visible(envelope)) listener(envelope)
    })
  }

  viewEvent(envelope: EnvironmentEventEnvelope): EnvironmentEventEnvelope {
    return envelope
  }
}
