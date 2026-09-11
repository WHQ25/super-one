import { extendHistoryIndex, mergeIndexedHistory, type SessionHistoryIndex } from '@superone/shared/session-history-index'
import { codexAsyncAnswerId } from '@superone/shared/codex-async-question'
import { requestMentionSearch, type MentionSearchOptions, type MentionSearchResult } from './mention-search'
import type {
  AgentEvent,
  ChatMessage,
  HarnessId,
  QuestionAnnotations,
  ImageAttachment,
  PermissionRequest,
  RemoteCommand,
  RemoteSystemInfo,
  SandboxInfo,
  SaveWidgetTemplateRequest,
  SavedWidgetTemplate,
  SandboxMode,
} from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultChatCoreSession, pendingSlashCommandFrom } from '@superone/chat-core'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import type { CachedTranscript, RelayClient } from '@superone/relay-client'
import { restoreSession } from '@superone/relay-client'
import { randomId } from './ids'

type SessionState = ReturnType<typeof createDefaultChatCoreSession>

export type SessionTranscriptCache = {
  get(pairingId: string, projectPath: string, sessionId: string): CachedTranscript | null
  put(pairingId: string, projectPath: string, sessionId: string, transcript: CachedTranscript): void
}

export type ChatRuntimeHooks = {
  onDetail?: (event: Extract<AgentEvent, { type: 'remote_detail' }>) => void
  onSessionRecap?: (sessionId: string) => void
  transcripts?: SessionTranscriptCache
  pairingId?: () => string | null
}

export type SystemInfo = RemoteSystemInfo

/** The worktree half of the restore snapshot, kept together so it updates atomically. */
export type SessionWorktreeFacts = {
  isWorktree: boolean
  worktreePath: string | null
  /** Branch recorded at creation; for a worktree session, the worktree's own. */
  gitBranch: string | null
}

const NO_WORKTREE: SessionWorktreeFacts = { isWorktree: false, worktreePath: null, gitBranch: null }

export type CreateSessionOptions = {
  /** Client-chosen id so the shell can leave the landing before the host answers. */
  sessionId?: string
  provider?: HarnessId
  acpAgentId?: string
  permissionMode?: string
  effort?: string
  model?: string
  gitBranch?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeMode?: 'branch' | 'attach' | 'detach'
  worktreeBranchName?: string
  worktreeCarryLocalChanges?: boolean
  additionalDirectories?: string[]
  /** ACP session mode picked on the draft. */
  mode?: string
  /** DeepSeek preset picked on the draft. */
  agentPreset?: string
  /** Credential the draft resolved to; `null` is the host default. */
  apiProviderId?: string | null
}

export class ChatRuntime {
  session: SessionState = createDefaultChatCoreSession()
  /**
   * A fact about the running process, not a setting — so it is only ever what the
   * host told us (restore snapshot, `init_ready`, `agent_setting_change`). `null`
   * means "not reported yet", which the chip renders as unknown rather than `off`.
   */
  sandboxInfo: SandboxInfo | null = null
  /**
   * Where the host says this session's process runs. Like `sandboxInfo` this is
   * a fact reported by the host, not something a phone can derive from the
   * project path — and restore re-reads it, so it survives a reconnect.
   */
  worktree: SessionWorktreeFacts = NO_WORKTREE
  projectPath = ''
  sessionId = ''
  provider: HarnessId | string = 'claude'
  permissionModes: string[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
  sessionTitle = ''
  models: { id?: string; name?: string }[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  restoreMetrics: Awaited<ReturnType<typeof restoreSession>>['metrics'] | null = null
  hasMoreHistory = false
  navigationAvailable = false
  private navigationIndex: SessionHistoryIndex | null = null
  private navigationRequest: Promise<SessionHistoryIndex> | null = null
  private historyCursor: number | null = null
  private historyRequest: Promise<ChatMessage[]> | null = null
  private eventEpoch = 0
  private restoreGeneration = 0
  private restoreQueue: Promise<void> = Promise.resolve()
  /** Request ids the phone already answered, so a replayed `ask_user_question` cannot reopen the sheet. */
  private resolvedQuestionIds = new Set<string>()

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (session: SessionState, hydrate: boolean) => void,
    private readonly hooks: ChatRuntimeHooks = {},
  ) {}

  async open(projectPath: string, sessionId: string): Promise<void> {
    this.persistTranscript()
    this.projectPath = projectPath
    this.sessionId = sessionId
    this.resolvedQuestionIds.clear()
    this.historyRequest = null
    this.navigationIndex = null
    this.navigationRequest = null
    const generation = ++this.restoreGeneration
    const restore = this.restoreQueue.then(async () => {
      if (generation !== this.restoreGeneration) return
      const cached = this.readTranscript(projectPath, sessionId)
      const restored = await restoreSession(this.client, projectPath, sessionId, cached)
      if (generation !== this.restoreGeneration) return
      this.restoreMetrics = restored.metrics
      this.navigationAvailable = restored.navigationAvailable === true
      this.hasMoreHistory = restored.hasMore
      this.historyCursor = restored.cursor
      let session = createDefaultChatCoreSession()
      session.messages = [...restored.messages]
      if (restored.provider) session.sessionProvider = restored.provider as SessionState['sessionProvider']
      if (restored.snapshot.permissionMode) {
        session.permissionMode = restored.snapshot.permissionMode as SessionState['permissionMode']
      }
      if (restored.snapshot.status === 'streaming' || restored.snapshot.status === 'idle') {
        session.status = restored.snapshot.status
      }
      // Usage only rides on the next turn's events, so a session opened cold would
      // paint an empty ring until the user sends something.
      session.contextTokens = restored.snapshot.contextTokens ?? 0
      session.totalCostUsd = restored.snapshot.totalCostUsd ?? 0
      this.sandboxInfo = restored.snapshot.sandboxInfo ?? null
      this.worktree = {
        isWorktree: restored.snapshot.isWorktree ?? false,
        worktreePath: restored.snapshot.worktreePath ?? null,
        gitBranch: restored.snapshot.gitBranch ?? null,
      }
      const liveMessages = restored.snapshot.inProgressMessages ?? []
      const liveIds = new Set(liveMessages.map((message) => message.id))
      session.messages = [...session.messages.filter((message) => !liveIds.has(message.id)), ...liveMessages]
      // Usage events predating the snapshot are intentionally deduplicated.
      // Restore the denominator from persisted usage before releasing live data.
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const metadata = session.messages[i]?.metadata
        const window = metadata?.codex?.usage?.contextWindow
          || Math.max(0, ...Object.values(metadata?.modelUsage ?? {}).map((usage) => usage.contextWindow ?? 0))
        if (window > 0) { session.contextWindow = window; break }
      }
      // Seeded before the replay below: the host persists a voice utterance before it
      // broadcasts it, so a buffered event is a duplicate of something already here
      // and the reducer needs the baseline present to recognise it as one.
      session.realtimeSegments = restored.snapshot.realtimeSegments ?? []
      session.realtimeSessionId = restored.snapshot.activeRealtimeSessionId ?? null
      const restoreEvents = [
        ...(restored.snapshot.pendingInteractions ?? []),
        ...restored.liveBatches.flat() as AgentEvent[],
      ]
      for (const event of restoreEvents) {
        if (event.sessionId && event.sessionId !== this.sessionId) continue
        if (this.handleSideEvent(event)) continue
        this.captureRuntimeFacts(event)
        if (!this.shouldApplyEvent(event)) continue
        session = this.reduce(session, event)
      }
      this.session = session
      this.eventEpoch = restored.epoch
      if (restored.provider) this.provider = restored.provider
      this.dirty = true
      // Replayed history is a baseline, even when the connection epoch is unchanged.
      this.flush(true)
      this.persistTranscript()
    })
    this.restoreQueue = restore.catch(() => {})
    await restore
  }

  /** Fetch one page without replacing live messages received during the request. */
  loadEarlier(): Promise<ChatMessage[]> {
    if (this.historyRequest) return this.historyRequest
    if (!this.hasMoreHistory || this.historyCursor == null) return Promise.resolve([])
    const generation = this.restoreGeneration
    const cursor = this.historyCursor
    const request = (async () => {
      const page = await this.client.request({
        type: 'load_session_messages', requestId: randomId(),
        projectPath: this.projectPath, sessionId: this.sessionId, limit: 24, cursor,
      }) as { messages?: ChatMessage[]; hasMore?: boolean; cursor?: number | null; error?: string }
      if (page.error) throw new Error(page.error)
      if (generation !== this.restoreGeneration) return []
      const ids = new Set(this.session.messages.map(message => message.id))
      const older = (page.messages ?? []).filter(message => !ids.has(message.id))
      this.session = { ...this.session, messages: this.navigationIndex
        ? mergeIndexedHistory(this.navigationIndex, older, this.session.messages) : [...older, ...this.session.messages] }
      this.historyCursor = page.cursor ?? null
      this.hasMoreHistory = Boolean(page.hasMore && this.historyCursor != null && this.historyCursor !== cursor)
      this.persistTranscript()
      return older
    })()
    this.historyRequest = request
    void request.finally(() => { if (this.historyRequest === request) this.historyRequest = null }).catch(() => {})
    return request
  }

  loadNavigationIndex(): Promise<SessionHistoryIndex> {
    if (this.navigationRequest) return this.navigationRequest
    if (this.navigationIndex) return Promise.resolve(extendHistoryIndex(this.navigationIndex, this.session.messages))
    const generation = this.restoreGeneration
    const request = (async () => {
      const result = await this.client.request({ type: 'get_session_history_index', requestId: randomId(),
        projectPath: this.projectPath, sessionId: this.sessionId }) as SessionHistoryIndex & { error?: string }
      if (result.error) throw new Error(result.error)
      if (generation !== this.restoreGeneration) throw new Error('Session changed')
      if (!Array.isArray(result.messageIds) || !Array.isArray(result.entries) || !Array.isArray(result.compacts)) throw new Error('Navigation index unavailable')
      this.navigationIndex = extendHistoryIndex(result, this.session.messages)
      return this.navigationIndex
    })()
    this.navigationRequest = request
    void request.finally(() => { if (this.navigationRequest === request) this.navigationRequest = null }).catch(() => {})
    return request
  }

  async loadHistoryWindow(anchorId: string, direction: 'around' | 'before' | 'after') {
    const generation = this.restoreGeneration
    const index = await this.loadNavigationIndex()
    if (generation !== this.restoreGeneration) throw new Error('Session changed')
    const result = await this.client.request({ type: 'load_session_messages', requestId: randomId(),
      projectPath: this.projectPath, sessionId: this.sessionId, anchorId, direction, limit: 8,
    }) as { messages?: ChatMessage[]; error?: string }
    if (result.error) throw new Error(result.error)
    if (generation !== this.restoreGeneration) throw new Error('Session changed')
    if (!Array.isArray(result.messages)) throw new Error('History is unavailable')
    this.session = { ...this.session, messages: mergeIndexedHistory(index, result.messages, this.session.messages) }
    return { messages: result.messages }
  }

  async subscribeDetail(detailRef: string, subscriptionId: string): Promise<Record<string, unknown>> {
    const result = await this.client.request({ type: 'subscribe_detail', requestId: randomId(),
      projectPath: this.projectPath, sessionId: this.sessionId, detailRef, subscriptionId }) as Record<string, unknown>
    if (result.error) throw new Error(String(result.error))
    return result
  }

  async unsubscribeDetail(subscriptionId: string): Promise<void> {
    await this.client.request({ type: 'unsubscribe_detail', requestId: randomId(),
      projectPath: this.projectPath, sessionId: this.sessionId, subscriptionId })
  }

  reopen(): Promise<void> {
    if (!this.projectPath || !this.sessionId) return Promise.resolve()
    return this.open(this.projectPath, this.sessionId)
  }

  async create(projectPath: string, opts: CreateSessionOptions = {}): Promise<string> {
    const sessionId = opts.sessionId ?? randomId()
    if (opts.provider) this.provider = opts.provider
    this.projectPath = projectPath
    this.sessionId = sessionId
    const res = await this.client.request({
      type: 'create_session',
      requestId: randomId(),
      sessionId,
      projectPath,
      ...(opts.provider ? { provider: opts.provider as HarnessId } : {}),
      ...(opts.acpAgentId ? { acpAgentId: opts.acpAgentId } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
      ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
      ...(opts.worktreeBranch ? { worktreeBranch: opts.worktreeBranch } : {}),
      ...(opts.worktreeMode ? { worktreeMode: opts.worktreeMode } : {}),
      ...(opts.worktreeBranchName ? { worktreeBranchName: opts.worktreeBranchName } : {}),
      ...(opts.worktreeCarryLocalChanges !== undefined
        ? { worktreeCarryLocalChanges: opts.worktreeCarryLocalChanges }
        : {}),
      ...(opts.additionalDirectories?.length
        ? { additionalDirectories: opts.additionalDirectories }
        : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.agentPreset ? { agentPreset: opts.agentPreset } : {}),
      ...(opts.apiProviderId !== undefined ? { apiProviderId: opts.apiProviderId } : {}),
    } as RemoteCommand) as { ok?: boolean; sessionId?: string; error?: string }
    if (res.error || res.ok === false) throw new Error(res.error ?? 'create_session failed')
    const id = res.sessionId ?? sessionId
    this.sessionId = id
    // A brand-new session has no history. Subscribe for live events without the
    // restore round-trip `open()` uses when switching to an existing transcript.
    this.client.startBuffering()
    try {
      const subscribed = await this.client.request({
        type: 'subscribe_session', projectPath, sessionId: id, progressive: true,
      } as RemoteCommand) as { error?: string }
      if (subscribed.error) throw new Error(subscribed.error)
      const { epoch, batches } = this.client.releaseBuffer()
      this.eventEpoch = epoch
      for (const batch of batches) this.ingest(batch as AgentEvent[], epoch)
    } catch (error) {
      this.client.releaseBuffer()
      throw error
    }
    return id
  }

  async loadSystemInfo(provider: string = String(this.provider)): Promise<SystemInfo> {
    if (!this.projectPath) return {}
    const info = await this.client.request({
      type: 'get_system_info', requestId: randomId(), projectPath: this.projectPath,
      provider: provider as HarnessId,
    } as RemoteCommand) as SystemInfo

    this.provider = provider
    if (info.permissionModes?.length) this.permissionModes = info.permissionModes
    else if (info.permissionPresets?.length) this.permissionModes = info.permissionPresets
    this.models = info.models ?? []
    if (info.defaults?.permissionMode && !this.session.permissionMode) {
      this.session.permissionMode = info.defaults.permissionMode as SessionState['permissionMode']
    }
    return info
  }

  ingest(events: unknown[], epoch: number = this.eventEpoch): void {
    if (epoch !== this.eventEpoch) return
    for (const ev of events) this.apply(ev as AgentEvent)
    this.schedule()
  }

  get epoch(): number {
    return this.eventEpoch
  }

  dispose(): void {
    this.persistTranscript()
    this.restoreGeneration += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.dirty = false
  }

  private pairingId(): string | null {
    return this.hooks.pairingId?.() ?? null
  }

  private readTranscript(projectPath: string, sessionId: string): CachedTranscript | null {
    const pairingId = this.pairingId()
    if (!pairingId || !this.hooks.transcripts) return null
    return this.hooks.transcripts.get(pairingId, projectPath, sessionId)
  }

  private persistTranscript(): void {
    const pairingId = this.pairingId()
    if (!pairingId || !this.hooks.transcripts || !this.projectPath || !this.sessionId) return
    if (this.session.messages.length === 0) return
    this.hooks.transcripts.put(pairingId, this.projectPath, this.sessionId, {
      messages: this.session.messages.filter((message) => !message.status || message.status === 'complete'),
      provider: String(this.provider),
      hasMore: this.hasMoreHistory,
      cursor: this.historyCursor,
      navigationAvailable: this.navigationAvailable,
    })
  }

  send(content: string, extra: {
    images?: ImageAttachment[]; model?: string; effort?: string
    /** OpenCode primary agent for this turn. */
    agent?: string | null
    /** Codex Fast service tier. */
    serviceTier?: string | null
    /** Cursor catalog params (param id → value). */
    modelParams?: Record<string, string>
    clientMessageId?: string
    priority?: 'now' | 'next' | 'later'
    /** Park then steer in one host command — composer Stair. */
    steer?: 'now' | 'next'
  } = {}): void {
    const cmd: RemoteCommand = {
      type: 'send_message',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      content,
      provider: this.provider as HarnessId,
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.effort ? { effort: extra.effort } : {}),
      ...(extra.images?.length ? { images: extra.images } : {}),
      ...(extra.agent ? { agent: extra.agent } : {}),
      ...(extra.serviceTier ? { serviceTier: extra.serviceTier } : {}),
      ...(extra.modelParams && Object.keys(extra.modelParams).length
        ? { modelParams: extra.modelParams }
        : {}),
      ...(extra.clientMessageId ? { clientMessageId: extra.clientMessageId } : {}),
      ...(extra.priority ? { priority: extra.priority } : {}),
      ...(extra.steer ? { steer: extra.steer } : {}),
    }
    // The wire messages that report this command's output carry no name, so the
    // only chance to learn it is here, from what the user actually sent.
    const queued = extra.priority === 'next' && extra.clientMessageId
      ? {
          id: extra.clientMessageId,
          role: 'user' as const,
          status: 'complete' as const,
          content: [{ type: 'text' as const, text: content }],
          createdAt: new Date().toISOString(),
          providerId: 'local',
          ...(extra.images?.length ? { attachments: extra.images } : {}),
        }
      : null
    this.session = {
      ...this.session,
      _pendingSlashCommand: pendingSlashCommandFrom(content),
      ...(queued ? { queuedMessages: [...this.session.queuedMessages, queued] } : {}),
    }
    if (queued) {
      this.dirty = true
      this.flush()
    }
    this.client.send(cmd)
  }

  dequeueMessage(clientMessageId: string): void {
    this.session = {
      ...this.session,
      queuedMessages: this.session.queuedMessages.filter((message) => message.id !== clientMessageId),
    }
    this.dirty = true
    this.flush()
    this.client.send({
      type: 'dequeue_message',
      clientMessageId,
      projectPath: this.projectPath,
      sessionId: this.sessionId,
    })
  }

  async steerQueuedMessage(clientMessageId: string, priority: 'now' | 'next' = 'now'): Promise<boolean> {
    if (!this.sessionId || !this.projectPath) return false
    const result = await this.client.request({
      type: 'steer_queued_message',
      requestId: randomId(),
      projectPath: this.projectPath,
      sessionId: this.sessionId,
      clientMessageId,
      priority,
    } as RemoteCommand) as { ok?: boolean; error?: string }
    if (result.error || result.ok === false) throw new Error(result.error ?? 'steer failed')
    return result.ok === true
  }

  /**
   * Grok manual `/recap` — host RPC, never a user message. Optimistic
   * `isRecapping` paints the generating line until `session_recap` arrives
   * (or the host says it did not send the RPC).
   */
  async requestRecap(): Promise<boolean> {
    if (!this.sessionId || !this.projectPath) return false
    this.session = { ...this.session, isRecapping: true }
    this.dirty = true
    this.flush()
    try {
      const result = await this.client.request({
        type: 'request_session_recap',
        requestId: randomId(),
        sessionId: this.sessionId,
        projectPath: this.projectPath,
      }) as { ok?: boolean; error?: string }
      const ok = result.ok === true
      if (!ok) {
        this.session = { ...this.session, isRecapping: false }
        this.dirty = true
        this.flush()
      }
      return ok
    } catch {
      this.session = { ...this.session, isRecapping: false }
      this.dirty = true
      this.flush()
      return false
    }
  }

  /**
   * Live model / effort / mode change on a running session — the same write the
   * desktop selector performs. A draft session carries its picks in `create`.
   */
  setSessionSettings(settings: { model?: string; effort?: string; mode?: string; agentPreset?: string }): void {
    if (!this.sessionId || !this.projectPath) return
    this.client.send({
      type: 'set_session_settings',
      projectPath: this.projectPath,
      sessionId: this.sessionId,
      ...settings,
    })
  }

  setSessionApiProviderId(apiProviderId: string | null): void {
    if (!this.sessionId || !this.projectPath) return
    this.client.send({
      type: 'set_session_api_provider_id',
      projectPath: this.projectPath,
      sessionId: this.sessionId,
      apiProviderId,
    })
  }

  async answerCodexAsyncQuestion(messageId: string, itemId: string, answers: string[]): Promise<void> {
    const { projectPath, sessionId } = this
    if (!projectPath || !sessionId) throw new Error('No active session')
    if (!this.session.messages.some(message => message.id === messageId)) throw new Error('Question session is no longer active')
    const result = await this.client.request({
      type: 'codex_async_question_answer', requestId: randomId(), projectPath, sessionId, messageId, itemId, answers,
    }) as { ok?: boolean; reply?: string; error?: string }
    if (result.error || !result.ok || typeof result.reply !== 'string') throw new Error(result.error ?? 'Answer was not accepted')
    if (this.sessionId !== sessionId || this.projectPath !== projectPath) return
    this.ingest([{ type: 'user_message_appended', message: {
      id: codexAsyncAnswerId(itemId), role: 'user', status: 'complete', providerId: 'codex',
      createdAt: new Date().toISOString(), content: [{ type: 'text', text: result.reply }],
    } }])
    this.flush()
  }

  interrupt(): void {
    const cmd: RemoteCommand = {
      type: 'interrupt',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
  }

  setPermissionMode(mode: string): void {
    this.session.permissionMode = mode as SessionState['permissionMode']
    this.client.send({
      type: 'set_permission_mode',
      mode,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    })
  }

  /**
   * Optimistic so the chip answers the tap, then reconciled against what the host
   * actually applied — a host that cannot sandbox (no bubblewrap on Linux) rejects
   * the change, and the guess would otherwise claim a confinement that is not there.
   */
  async setSandboxMode(mode: SandboxMode): Promise<void> {
    if (!this.sessionId || !this.projectPath) return
    this.sandboxInfo = sandboxInfoFromMode(mode)
    this.dirty = true
    this.flush()
    const res = await this.client.request({
      type: 'set_sandbox_mode',
      requestId: randomId(),
      mode,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    } as RemoteCommand) as { sandboxInfo?: SandboxInfo; error?: string }
    if (res.sandboxInfo) {
      this.sandboxInfo = res.sandboxInfo
      this.dirty = true
      this.flush()
    }
    if (res.error) throw new Error(res.error)
  }

  /** Save the widget the phone is looking at into the host's template store. */
  async saveWidgetTemplate(input: SaveWidgetTemplateRequest): Promise<void> {
    const res = await this.client.request({
      type: 'save_widget_template',
      requestId: randomId(),
      projectPath: this.projectPath,
      input,
    } as RemoteCommand) as { template?: SavedWidgetTemplate; error?: string }
    if (res.error) throw new Error(res.error)
  }

  searchMentions(query: string, options?: MentionSearchOptions): Promise<MentionSearchResult> {
    return requestMentionSearch(this.client, this.projectPath, query, options)
  }

  /** Root the composer browses: a worktree session is not the project folder. */
  get mentionRoot(): string {
    return this.worktree.worktreePath || this.projectPath
  }

  respondPermission(
    requestId: string,
    decision: boolean,
    formAnswers?: Record<string, unknown>,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
  ): void {
    const cmd: RemoteCommand = {
      type: 'respond_permission',
      requestId,
      decision,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(alwaysAllow !== undefined ? { alwaysAllow } : {}),
      ...(reason ? { reason } : {}),
      ...(selectedSuggestions?.length ? { selectedSuggestions } : {}),
      ...(formAnswers ? { formAnswers } : {}),
    }
    this.client.send(cmd)
  }

  respondPlan(requestId: string, approved: boolean, feedback?: string): void {
    const cmd: RemoteCommand = {
      type: 'respond_plan_approval',
      requestId,
      approved,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(feedback ? { feedback } : {}),
    }
    this.client.send(cmd)
  }

  respondCodexPlan(messageId: string, status: 'approved' | 'rejected', feedback?: string): void {
    this.client.send({
      type: 'codex_plan_approval',
      messageId,
      status,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(feedback ? { feedback } : {}),
    })
  }

  answerQuestion(
    requestId: string,
    answers: Record<string, string>,
    annotations?: QuestionAnnotations,
  ): void {
    const cmd: RemoteCommand = {
      type: 'answer_question',
      requestId,
      answers,
      ...(annotations ? { annotations } : {}),
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
    this.resolveQuestionLocally(requestId)
  }

  dismissQuestion(requestId: string): void {
    const cmd: RemoteCommand = {
      type: 'dismiss_question',
      requestId,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
    this.resolveQuestionLocally(requestId)
  }

  /**
   * The native sheet is a blocking Modal. Desktop continues as soon as the
   * command is sent; waiting for `interaction_resolved` left the phone stuck
   * on the question while the host was already streaming.
   */
  private resolveQuestionLocally(requestId: string): void {
    this.ingest([{ type: 'interaction_resolved', interactionType: 'question', requestId }])
    this.flush()
  }

  get pendingPermission(): PermissionRequest | undefined {
    return this.session.pendingPermissions[0]
  }

  get messages(): ChatMessage[] {
    return this.session.messages
  }

  get streaming(): boolean {
    return this.session.status === 'streaming' || this.session.awaitingAssistantReply
  }

  get permissionMode(): string {
    return String(this.session.permissionMode ?? 'default')
  }

  get contextTokens(): number {
    return this.session.contextTokens
  }

  get contextWindow(): number | null {
    return this.session.contextWindow
  }

  get totalCostUsd(): number {
    return this.session.totalCostUsd
  }

  get todos(): SessionState['todos'] {
    return this.session.todos
  }

  /** Stdout from a command that renders nowhere in the transcript. */
  get slashCommandOutput(): SessionState['slashCommandOutput'] {
    return this.session.slashCommandOutput
  }

  clearSlashCommandOutput(): void {
    if (!this.session.slashCommandOutput) return
    this.session = { ...this.session, slashCommandOutput: null }
    this.dirty = true
    this.flush()
  }

  private apply(event: AgentEvent): void {
    if (event.sessionId && event.sessionId !== this.sessionId) return
    if (event.type === 'session_title_changed' && event.sessionId === this.sessionId) {
      this.sessionTitle = event.title
    }
    this.captureRuntimeFacts(event)
    if (this.handleSideEvent(event)) return
    if (!this.shouldApplyEvent(event)) return
    this.session = this.reduce(this.session, event)
    this.dirty = true
    if (event.type === 'session_recap') this.hooks.onSessionRecap?.(this.sessionId)
  }

  private shouldApplyEvent(event: AgentEvent): boolean {
    if (event.type === 'interaction_resolved' && event.interactionType === 'question') {
      this.resolvedQuestionIds.add(event.requestId)
    }
    return !(event.type === 'ask_user_question' && this.resolvedQuestionIds.has(event.request.requestId))
  }

  /**
   * Session state the chat reducer does not carry. Runs on the restore replay too,
   * which bypasses `apply()` — miss that and a resumed session shows the sandbox
   * the snapshot reported instead of the one a later event corrected it to.
   */
  private captureRuntimeFacts(event: AgentEvent): void {
    if (event.type === 'init_ready') this.sandboxInfo = event.sandboxInfo
    if (event.type === 'agent_setting_change' && event.patch?.sandboxInfo) {
      this.sandboxInfo = event.patch.sandboxInfo
    }
  }

  private handleSideEvent(event: AgentEvent): boolean {
    if (event.type === 'remote_detail') {
      if (event.sessionId === this.sessionId) this.hooks.onDetail?.(event)
      return true
    }
    return false
  }

  private reduce(session: SessionState, event: AgentEvent): SessionState {
    const patch = applyEventToSession(session, event)
    return { ...session, ...patch }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, AGENT_EVENT_BATCH_MS)
  }

  flush(hydrate = false): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty) return
    this.dirty = false
    this.onPaint(this.session, hydrate)
  }
}
