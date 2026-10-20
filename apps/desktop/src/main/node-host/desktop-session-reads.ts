import {
  HOST_ACTION_CAPABILITY_VERSION,
  HOST_ACTION_TOOL_GROUPS,
  type EnvironmentEventEnvelope,
} from '@superone/shared/environment'
import type { SessionHistoryIndex } from '@superone/shared/session-history-index'
import type { ChatMessage, ModelOption, SandboxInfo } from '@superone/shared/agent-types'
import type { SessionRestoreFacts } from '@superone/shared/environment'
import type { SessionHostPort, TranscriptWindowView } from '@superone/runtime/server'
import { arrayTranscript } from '@superone/runtime/stream/delivery/transcript-access'
import type { EventLog, NodeSessionRecord, PendingInteraction } from '@superone/runtime/session'
import { chatMessageToSessionMessageBlock } from '@superone/shared/node-message-catalog'
import { applyEventToSession, createDefaultChatCoreSession, withTranscriptTodos, type ChatCoreSession } from '@superone/chat-core'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from '../session/types'
import type { NodeHostSessionManager } from './desktop-session-host'
import type { AgentEvent } from '@superone/shared/agent-types'
import { activeTurnOutsidePage, sessionMessageRange } from '@superone/shared/environment/session-message-range'
import { pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { coldMcpMessages, coldQuestionMessages, coldTodoMessage, openColdTranscript } from '../session/cold-transcript'
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
  /** One stored message by id, without paging the transcript in. */
  loadMessage?(sessionId: string, messageId: string): ChatMessage | null
}

export interface DesktopSessionReadsDeps<Row extends DesktopSessionRow> {
  environmentId: string
  restore?: DesktopRestorePorts
  sessions: NodeHostSessionManager
  events: EventLog
  rows: DesktopSessionRows<Row>
  /**
   * Display names for an ACP agent when the live session has not replayed
   * `acp_models` (a cold open). The host's own catalog, never the controller's.
   */
  acpModelCatalog?(agentId: string): { models: ModelOption[]; configId: string | null } | null
}

/** Fill ACP model display names from the host catalog when replay did not. */
export function attachAcpModelCatalog(
  state: ChatCoreSession,
  agentId: string | null | undefined,
  lookup: ((agentId: string) => { models: ModelOption[]; configId: string | null } | null) | undefined,
): ChatCoreSession {
  if (!lookup || !agentId || state.acpModels.length > 0) return state
  const cached = lookup(agentId)
  if (!cached?.models.length) return state
  return {
    ...state,
    acpModels: cached.models,
    acpModelsStatus: 'ready',
    acpModelConfigId: cached.configId,
    acpModelsError: null,
  }
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

function coldTodoMessages(sessionId: string): ChatMessage[] {
  const message = coldTodoMessage(sessionId)
  return message ? [message] : []
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
  'get' | 'list' | 'load' | 'readTranscriptWindow' | 'messages' | 'listMessages' | 'snapshotSequence' | 'listEventsAfter' | 'streamEpoch'
  | 'streamingAfter' | 'streamingEvents' | 'onEventsAppended' | 'viewEvent' | 'detailMessages' | 'detailMessage'> {
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
      // Live agent wins; a cold row still names the agent the sidebar icon needs.
      acpAgentId: live?.snapshot.acpAgentId || row.acpAgentId || null,
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
    const includeState = input.includeState !== false
    const sandboxInfo = includeState ? await this.reads.restore?.prepare?.(this.reads.sessions.getSession(sessionId)) : undefined
    // No awaits after this point: facts, rows and cursor cover the same session version.
    const all = this.messages(sessionId)
    const snap = this.snapshotAt(sessionId, includeState, sandboxInfo, { todos: all, questions: all, history: all })
    const { start, end } = sessionMessageRange(all, input)
    const messages = all.slice(start, end)
    if (!includeState) return {
      sessionId, state: {}, messages, before: start > 0 ? start : null, after: end < all.length ? end : null, cursor: snap.cursor,
    }
    const activeTurn = snap.live ? activeTurnOutsidePage(all, { start, end }) : []
    return {
      sessionId,
      state: snap.state,
      messages,
      ...(activeTurn.length ? { activeTurn } : {}),
      ...(snap.restore ? { restore: snap.restore } : {}),
      before: start > 0 ? start : null,
      after: end < all.length ? end : null,
      cursor: snap.cursor,
    }
  }

  /**
   * The window read. `read` runs in this turn, after `prepare` and with no
   * further await, so the rows it touches, the derived state, and the cursor
   * describe one session version. A live session feeds the cutter its snapshot.
   * A cold session parses only the rows the cutter asks for.
   */
  async readTranscriptWindow<T>(input: { sessionId: string; includeState: boolean; read: (view: TranscriptWindowView) => T }): Promise<T> {
    const sessionId = String(input.sessionId ?? '').trim()
    this.requireRow(sessionId)
    const includeState = input.includeState !== false
    const sandboxInfo = includeState ? await this.reads.restore?.prepare?.(this.reads.sessions.getSession(sessionId)) : undefined
    const live = this.reads.sessions.getSession(sessionId)
    const transcript = live ? arrayTranscript(live.snapshot.messages) : openColdTranscript(sessionId)
    const sources = live
      ? { todos: live.snapshot.messages, questions: live.snapshot.messages, history: live.snapshot.messages }
      : includeState
        ? { todos: coldTodoMessages(sessionId), questions: coldQuestionMessages(sessionId), history: coldMcpMessages(sessionId) }
        : { todos: [], questions: [], history: [] }
    const snap = this.snapshotAt(sessionId, includeState, sandboxInfo, sources)
    return input.read({
      transcript,
      state: snap.state,
      ...(snap.restore ? { restore: snap.restore } : {}),
      cursor: snap.cursor,
    })
  }

  /** Reduced state at the cursor. Callers have already finished every await. */
  private snapshotAt(sessionId: string, includeState: boolean, sandboxInfo: SandboxInfo | undefined, sources: {
    todos: readonly ChatMessage[]
    questions: readonly ChatMessage[]
    history: readonly ChatMessage[]
  }) {
    const row = this.requireRow(sessionId)
    const live = this.reads.sessions.getSession(sessionId)
    const replay = [...(live?.getReplayEvents() ?? []), ...(live?.getPendingInteractions() ?? [])]
    let state: ChatCoreSession = createDefaultChatCoreSession()
    for (const event of replay) state = { ...state, ...applyEventToSession(state, event) }
    const { events } = this.reads
    const cursor = { sequence: events.headSequence(), epoch: events.epoch, version: events.sessionVersion(sessionId) }
    if (!includeState) return { live, state: {} as Record<string, unknown>, restore: undefined as SessionRestoreFacts | undefined, cursor }
    state = withTranscriptTodos(state, sources.todos, replay.some((event) => event.type === 'todos_updated'))
    state.pendingAsyncQuestions = pendingCodexAsyncQuestions(sources.questions)
    if (row.harnessId === 'acp') {
      state = attachAcpModelCatalog(state, live?.snapshot?.acpAgentId ?? row.acpAgentId, this.reads.acpModelCatalog)
    }
    const facts = sessionRestoreFacts({ session: live, row, history: sources.history, environmentId: this.reads.environmentId, sandboxInfo, realtime: this.reads.restore?.realtime?.(sessionId) })
    const { restore, ...current } = facts
    const stored = this.reads.restore?.stored?.(sessionId) ?? null
    const { messages: _messages, ...rest } = {
      ...state, ...current, cwd: live?.cwd ?? row.worktreePath ?? row.projectPath,
      _providerSessionId: row.providerSessionId, sessionProvider: row.harnessId, preferredProvider: row.harnessId,
      _worktreeRemoved: restore.worktreeMissing, ...(stored ? { stored } : {}),
    }
    return { live, state: rest as unknown as Record<string, unknown>, restore, cursor }
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

  /**
   * One row to expand. A cold session reads it by id: a window can page past
   * the newest stored page that `messages` returns.
   */
  detailMessage(sessionId: string, messageId: string): ChatMessage | null {
    this.requireRow(sessionId)
    const find = (messages: readonly ChatMessage[]) => messages.find((message) => message.id === messageId) ?? null
    if (this.reads.sessions.getSession(sessionId) || !this.reads.rows.loadMessage) return find(this.detailMessages(sessionId))
    return this.reads.rows.loadMessage(sessionId, messageId) ?? find(this.reads.restore?.realtime?.(sessionId)?.threadMessages ?? [])
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
