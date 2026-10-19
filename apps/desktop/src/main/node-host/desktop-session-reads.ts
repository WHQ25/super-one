import {
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  type EnvironmentEventEnvelope,
} from '@superone/shared/environment'
import type { SessionHistoryIndex } from '@superone/shared/session-history-index'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionHostPort } from '@superone/runtime/server'
import type { EventLog, NodeSessionRecord, PendingInteraction } from '@superone/runtime/session'
import { chatMessageToSessionMessageBlock } from '@superone/shared/node-message-catalog'
import { applyEventToSession, createDefaultChatCoreSession, withTranscriptTodos, type ChatCoreSession } from '@superone/chat-core'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { NodeHostSessionManager } from './desktop-session-host'
import type { AgentEvent } from '@superone/shared/agent-types'
import { activeTurnOutsidePage, sessionMessageRange } from '@superone/shared/environment/session-message-range'
import { pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { sessionRestoreFacts, type DesktopRestorePorts } from '../session/session-restore-facts'

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
  environmentId: string
  restore?: DesktopRestorePorts
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

function sessionFamilyId(row: { sessionId: string; parentSessionId?: string | null }): string {
  return row.parentSessionId || row.sessionId
}

/**
 * One sidebar page. A spawn parent and its children stay on the page that first
 * includes them: the next offset is the number of rows already returned, so a
 * short page would look like the end of the list.
 */
export function pageSessionRows<T extends { sessionId: string; parentSessionId?: string | null }>(
  rows: readonly T[],
  offset = 0,
  limit?: number,
): T[] {
  const start = Math.max(0, offset)
  if (start >= rows.length) return []
  if (limit == null) return rows.slice(start)
  let end = Math.min(rows.length, start + Math.max(0, limit))
  if (end <= start) return []
  if (end < rows.length) {
    const family = sessionFamilyId(rows[end - 1]!)
    while (end < rows.length && sessionFamilyId(rows[end]!) === family) end += 1
  }
  return rows.slice(start, end)
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
  | 'streamingAfter' | 'streamingEvents' | 'onEventsAppended' | 'viewEvent' | 'detailMessages'> {
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

  /** The stored row this host serves; a host may also serve live sessions that have none. */
  protected row(sessionId: string): Row | null {
    return this.reads.rows.get(sessionId)
  }

  protected requireRow(sessionId: string): Row {
    const row = this.row(sessionId)
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
      sandboxMode: controller ? controller.sandboxMode ?? null : live ? (live.getCurrentSandboxInfo().enabled ? live.getCurrentSandboxInfo().autoAllowBash ? 'auto' : 'on' : 'off') : null,
      model: controller ? controller.model ?? null : live?.getSelectedModel() ?? null,
      effort: controller ? controller.effort ?? null : live?.getSelectedEffort() ?? null,
      apiProviderId: controller ? controller.apiProviderId ?? null : live?.getApiProviderId() ?? null,
      mode: live?.getUiSettings().selectedAcpModeId ?? controller?.mode ?? null,
      agentPreset: live?.getAgentPreset() ?? controller?.agentPreset ?? null,
      additionalDirectories: live?.getCallerScopedDirsSnapshot() ?? controller?.additionalDirectories ?? null,
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
      ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
    }
  }

  get(sessionId: string): NodeSessionRecord | null {
    const row = this.row(sessionId)
    return row ? this.record(row) : null
  }

  list(projectId?: string, options?: { limit?: number; offset?: number }): NodeSessionRecord[] {
    const rows = this.reads.rows.list(projectId)
    return pageSessionRows(rows, options?.offset ?? 0, options?.limit).map((row) => this.record(row))
  }

  /**
   * The live session's messages and prompts (its stored transcript when it is
   * not loaded), at the version its recorded events have reached.
   */
  async load(input: Parameters<SessionHostPort['load']>[0]) {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireRow(sessionId)
    const sandboxInfo = input.includeState === false ? undefined : await this.reads.restore?.prepare?.(this.reads.sessions.getSession(sessionId))
    // No awaits after this point: facts, rows and cursor cover the same session version.
    const row = this.requireRow(sessionId)
    const live = this.reads.sessions.getSession(sessionId)
    const replay = [...(live?.getReplayEvents() ?? []), ...(live?.getPendingInteractions() ?? [])]
    let state: ChatCoreSession = createDefaultChatCoreSession()
    for (const event of replay) state = { ...state, ...applyEventToSession(state, event) }
    const all = this.messages(sessionId)
    if (input.includeState !== false) {
      state = withTranscriptTodos(state, all, replay.some((event) => event.type === 'todos_updated'))
    }
    state.pendingAsyncQuestions = pendingCodexAsyncQuestions(all)
    const { start, end } = sessionMessageRange(all, input)
    const messages = all.slice(start, end)
    if (input.includeState === false) return {
      sessionId, state: {}, messages, before: start > 0 ? start : null, after: end < all.length ? end : null,
      cursor: { sequence: this.reads.events.headSequence(), epoch: this.reads.events.epoch, version: this.reads.events.sessionVersion(sessionId) },
    }
    const activeTurn = live ? activeTurnOutsidePage(all, { start, end }) : []
    const facts = sessionRestoreFacts({ session: live, row, history: all, environmentId: this.reads.environmentId, sandboxInfo, realtime: this.reads.restore?.realtime?.(sessionId) })
    const { restore, ...current } = facts
    const stored = this.reads.restore?.stored?.(sessionId) ?? null
    const { messages: _messages, ...rest } = { ...state, ...current, cwd: live?.cwd ?? row.worktreePath ?? row.projectPath, _providerSessionId: row.providerSessionId, sessionProvider: row.harnessId, preferredProvider: row.harnessId, _worktreeRemoved: restore.worktreeMissing, ...(stored ? { stored } : {}) }
    const { events } = this.reads
    return {
      sessionId,
      state: rest as unknown as Record<string, unknown>,
      messages,
      ...(activeTurn.length ? { activeTurn } : {}),
      restore,
      before: start > 0 ? start : null,
      after: end < all.length ? end : null,
      cursor: { sequence: events.headSequence(), epoch: events.epoch, version: events.sessionVersion(sessionId) },
    }
  }

  messages(sessionId: string): ChatMessage[] {
    this.requireRow(sessionId)
    const live = this.reads.sessions.getSession(sessionId)
    return live ? [...live.snapshot.messages] : this.reads.rows.loadMessages(sessionId, Number.MAX_SAFE_INTEGER).messages
  }

  /** Built from SQLite outlines with bounded previews instead of whole messages. */
  async historyIndex(sessionId: string): Promise<SessionHistoryIndex> {
    this.requireRow(sessionId)
    const { loadSessionHistoryIndex } = await import('../session/history-navigation')
    return loadSessionHistoryIndex(sessionId)
  }

  detailMessages(sessionId: string): ChatMessage[] {
    const messages = this.messages(sessionId)
    const canonical = this.reads.restore?.realtime?.(sessionId)?.threadMessages ?? []
    const byId = new Map(messages.map(message => [message.id, message]))
    for (const message of canonical) if (!byId.has(message.id)) byId.set(message.id, message)
    return [...byId.values()]
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

  listEventsAfter(afterSequence: string, reader?: { clientSessionId: string }): EnvironmentEventEnvelope[] {
    const events = this.reads.events.listAfter(afterSequence)
    return reader ? events.map((envelope) => this.viewEvent(envelope, reader)) : events
  }

  streamEpoch(): string {
    return this.reads.events.epoch
  }

  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null {
    return this.reads.events.streamingAfter(sessionId, version)
  }

  streamingEvents(): EnvironmentEventEnvelope[] {
    return this.reads.events.streaming()
  }

  onEventsAppended(listener: (envelope: EnvironmentEventEnvelope) => void): () => void {
    return this.reads.events.onAppend(listener)
  }

  viewEvent(envelope: EnvironmentEventEnvelope, _reader?: { clientSessionId: string }): EnvironmentEventEnvelope {
    return envelope
  }
}
