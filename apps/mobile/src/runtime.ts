import type { ChatRuntimeHooks, CreateSessionOptions, SessionWorktreeFacts, SystemInfo, SendMessageOptions } from './runtime-types'
export type { ChatRuntimeHooks, CreateSessionOptions, SessionTranscriptCache, SessionWorktreeFacts, SystemInfo, SendMessageOptions } from './runtime-types'
import { InputRequestSends } from './runtime-input-request-sends'
import { localUserMessage } from './runtime-user-message'
import { WidgetComposerClient } from './widget-composer-client'
import { parseInputRequestError } from '@superone/shared/input-request'
import { networkLedger } from './network-ledger'
import { requestHarnessResource } from './harness-resource-cache'
import { McpAppContextAttachments } from './mcp-app-context-attachments'
import { extendHistoryIndex, mergeIndexedHistory, type SessionHistoryIndex } from '@superone/shared/session-history-index'
import { isCompactSlashSend } from '@superone/shared/compact-boundary'
import { codexAsyncAnswerId } from '@superone/shared/codex-async-question'
import { requestMentionSearch, type MentionSearchOptions, type MentionSearchResult } from './mention-search'
import type {
  AgentEvent,
  ChatMessage,
  CodexGoalStatus,
  HarnessId,
  QuestionAnnotations,
  ImageAttachment,
  PermissionRequest,
  SandboxInfo,
  SaveWidgetTemplateRequest,
  SandboxMode,
} from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultChatCoreSession, failedMessageResend, pendingSlashCommandFrom, withoutSendFailure } from '@superone/chat-core'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { sandboxInfoFromMode } from '@superone/shared/harness/harness-sandbox'
import type { CachedTranscript, RelayClient } from '@superone/relay-client'
import { restoreSession } from '@superone/relay-client'
import { randomId } from './ids'
import { newMessageId } from '@superone/shared/message-id'
import { isDuplicateSend } from '@superone/shared/send-failure'
import { createSessionPayload } from './runtime-create-session'
import { runtimeSessionRef, readRuntimeSession } from './runtime-session-rpc'
import type { SessionLoadResult } from '@superone/shared/environment/session-messages'
import type { SessionSendSelections } from '@superone/shared/environment/session-send'

type SessionState = ReturnType<typeof createDefaultChatCoreSession>

const NO_WORKTREE: SessionWorktreeFacts = { isWorktree: false, worktreePath: null, gitBranch: null }

type SendMessageCommand = SessionSendSelections & SendMessageOptions & { sessionId: string; environmentId: string; text: string }

export class ChatRuntime {
  sourceEnvironmentId: string | null = null
  private readonly appContexts = new McpAppContextAttachments()
  get contextAttachments() { return this.appContexts.items(this.session.messages) }
  removeContextAttachment(id: string): Promise<void> {
    return this.appContexts.remove(id, this.client, { projectPath: this.projectPath, sessionId: this.sessionId, environmentId: this.sourceEnvironmentId }, this.session.messages)
  }
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
  /**
   * Sends the host never took, kept to replay exactly as they went out. In
   * memory like the desktop's: a failed bubble is not cached, so it and its
   * replay disappear together.
   */
  readonly inputRequestSends = new InputRequestSends()
  private readonly failedSends = new Map<string, SendMessageCommand>()
  /** `create_session` is in flight: a staged turn reads "creating" rather than "sending". */
  private creating = false
  private restoreQueue: Promise<void> = Promise.resolve()
  /** Request ids the phone already answered, so a replayed `ask_user_question` cannot reopen the sheet. */
  private resolvedQuestionIds = new Set<string>()
  private resolvedPermissionIds = new Set<string>()
  readonly widgetComposers: WidgetComposerClient

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (session: SessionState, hydrate: boolean) => void,
    private readonly hooks: ChatRuntimeHooks = {},
  ) {
    this.widgetComposers = new WidgetComposerClient(client, () => ({ projectPath: this.projectPath, sessionId: this.sessionId, environmentId: this.sourceEnvironmentId }),
      result => this.hooks.onComposerResult?.(result))
  }

  private sessionRef() { return runtimeSessionRef(this.client, this.sessionId, this.sourceEnvironmentId) }
  private read<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    return readRuntimeSession<T>(this.client, this.sessionRef(), method, payload)
  }
  private control<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    return this.client.controlledRpc<T>(this.sessionRef(), method, payload)
  }
  private command(method: string, payload: Record<string, unknown> = {}): void {
    void this.control(method, payload).catch(error => this.hooks.onCommandError?.(error instanceof Error ? error.message : String(error)))
  }

  async open(projectPath: string, sessionId: string, prepared?: import('@superone/relay-client').RestoredSession): Promise<void> {
    this.persistTranscript()
    if (this.projectPath !== projectPath || this.sessionId !== sessionId) this.widgetComposers.releaseAll()
    this.projectPath = projectPath
    this.sessionId = sessionId
    this.appContexts.restore(undefined)
    this.resolvedQuestionIds.clear()
    this.resolvedPermissionIds.clear()
    this.attachmentBytes.clear()
    this.historyRequest = null
    this.navigationIndex = null
    this.navigationRequest = null
    const generation = ++this.restoreGeneration
    const restore = this.restoreQueue.then(async () => {
      if (generation !== this.restoreGeneration) return
      const cached = this.readTranscript(projectPath, sessionId)
      networkLedger.mark('open-session')
      if (cached?.messages.length) {
        this.appContexts.restore(cached.mcpAppContexts)
        this.session = { ...createDefaultChatCoreSession(), messages: this.appContexts.reconcile(cached.messages) }
        this.hasMoreHistory = cached.hasMore
        this.historyCursor = cached.cursor
        if (cached.provider) this.provider = cached.provider
        this.dirty = true
        this.flush(true)
        this.hooks.onCachedHydrate?.()
        networkLedger.checkpoint('cached-hydrate')
      }
      const restored = prepared ?? await restoreSession(this.client, projectPath, sessionId, cached)
      if (generation !== this.restoreGeneration) return
      this.sourceEnvironmentId = restored.snapshot.sourceEnvironmentId ?? null
      this.restoreMetrics = restored.metrics
      this.appContexts.restore(restored.snapshot.mcpAppContexts)
      this.navigationAvailable = restored.navigationAvailable === true
      this.hasMoreHistory = restored.hasMore
      this.historyCursor = restored.cursor
      let session = { ...createDefaultChatCoreSession(), ...restored.state } as SessionState
      session.messages = [...restored.messages]
      if (restored.provider) session.sessionProvider = restored.provider as SessionState['sessionProvider']
      if (restored.snapshot.permissionMode) {
        session.permissionMode = restored.snapshot.permissionMode as SessionState['permissionMode']
      }
      session.ultracode = restored.snapshot.ultracode ?? false
      // The harness reports the goal only when it changes; restore is the one
      // place a phone that missed that event learns it.
      session.sessionGoal = restored.snapshot.goal ?? null
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
      session.messages = this.appContexts.reconcile(session.messages)
      // Usage events predating the snapshot are intentionally deduplicated.
      // Restore the denominator from persisted usage before releasing live data.
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const metadata = session.messages[i]?.metadata
        const window = metadata?.codex?.usage?.contextWindow
          || Math.max(0, ...Object.values(metadata?.modelUsage ?? {}).map((usage) => usage.contextWindow ?? 0))
        if (window > 0) { if (!session.contextWindow) session.contextWindow = window; break }
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
        if (event.environmentId && event.environmentId !== this.sourceEnvironmentId) continue
        if (event.sessionId && event.sessionId !== this.sessionId) continue
        if (this.handleSideEvent(event)) continue
        this.captureRuntimeFacts(event, session.messages)
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
      networkLedger.checkpoint('restore-ready')
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
      const loaded = await this.read<SessionLoadResult>('session.load', { before: cursor, limit: 24, includeState: false })
      const page = { messages: loaded.messages, hasMore: loaded.before != null, cursor: loaded.before }
      if (generation !== this.restoreGeneration) return []
      const ids = new Set(this.session.messages.map(message => message.id))
      const older = (page.messages ?? []).filter(message => !ids.has(message.id))
      this.session = { ...this.session, messages: this.navigationIndex
        ? mergeIndexedHistory(this.navigationIndex, older, this.session.messages) : [...older, ...this.session.messages] }
      this.session = { ...this.session, messages: this.appContexts.reconcile(this.session.messages) }
      this.historyCursor = page.cursor ?? null
      this.hasMoreHistory = Boolean(page.hasMore && this.historyCursor != null && this.historyCursor !== cursor)
      this.persistTranscript()
      return this.appContexts.reconcile(older)
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
      const result = await this.read<SessionHistoryIndex>('session.historyIndex')
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
    const result = await this.read<SessionLoadResult>('session.load', { anchorId, direction, limit: 8, includeState: false })
    if (generation !== this.restoreGeneration) throw new Error('Session changed')
    if (!Array.isArray(result.messages)) throw new Error('History is unavailable')
    this.session = { ...this.session, messages: mergeIndexedHistory(index, result.messages, this.session.messages) }
    this.session = { ...this.session, messages: this.appContexts.reconcile(this.session.messages) }
    return { messages: this.appContexts.reconcile(result.messages) }
  }

  async subscribeDetail(detailRef: string, subscriptionId: string): Promise<Record<string, unknown>> {
    const session = this.sessionRef()
    const projectPath = this.projectPath
    const update = await this.client.subscribeDetail({ sessionId: session.sessionId, detailRef, subscriptionId }, value => {
      this.hooks.onDetail?.({ type: 'remote_detail', ...value, ...session, projectPath })
    }, { environmentId: session.environmentId })
    return { ...update }
  }

  async unsubscribeDetail(subscriptionId: string): Promise<void> {
    const session = this.sessionRef()
    await this.client.unsubscribeDetail({ sessionId: session.sessionId, subscriptionId }, { environmentId: session.environmentId })
  }

  reopen(): Promise<void> {
    if (!this.projectPath || !this.sessionId) return Promise.resolve()
    void this.widgetComposers.recover()
    return this.open(this.projectPath, this.sessionId)
  }

  async create(projectPath: string, opts: CreateSessionOptions = {}): Promise<string> {
    const sessionId = opts.sessionId ?? randomId()
    if (opts.provider) this.provider = opts.provider
    this.projectPath = projectPath
    this.sessionId = sessionId
    this.sourceEnvironmentId = null
    this.creating = true
    try {
      const id = await this.createOnHost(projectPath, sessionId, opts)
      this.creating = false
      // A staged turn moves from "creating" to "sending" here.
      this.dirty = true
      this.flush()
      return id
    } catch (error) {
      this.creating = false
      // The staged bubble belongs to a session that never came to be; a blank id
      // keeps `dispose()` from caching it as that session's transcript.
      this.sessionId = ''
      throw error
    }
  }

  private async createOnHost(projectPath: string, sessionId: string, opts: CreateSessionOptions): Promise<string> {
    const project = await this.client.resolveProject(projectPath)
    const res = await this.client.rpc<{ sessionId: string }>('session.create', createSessionPayload(project, sessionId, opts), { environmentId: project.environmentId })
    const id = res.sessionId
    this.sessionId = id
    this.sourceEnvironmentId = project.environmentId
    const restored = await restoreSession(this.client, projectPath, id)
    this.sourceEnvironmentId = restored.snapshot.sourceEnvironmentId ?? project.environmentId
    this.worktree = { isWorktree: restored.snapshot.isWorktree ?? false, worktreePath: restored.snapshot.worktreePath ?? null, gitBranch: restored.snapshot.gitBranch ?? null }
    this.sandboxInfo = restored.snapshot.sandboxInfo ?? null
    this.eventEpoch = restored.epoch
    for (const batch of restored.liveBatches) this.ingest(batch as AgentEvent[], restored.epoch)
    return id
  }

  /**
   * The original bytes behind a `preview` thumbnail in the transcript, as a
   * data URI for the viewer. Memoised: opening the same picture twice must not
   * cost a second transfer.
   */
  async loadAttachment(messageId: string, ref: { attachmentId?: string; name: string }): Promise<string> {
    const attachment = await this.originalAttachment(messageId, ref)
    return `data:${attachment.mimeType};base64,${attachment.base64}`
  }

  /**
   * A queued message's attachments with full bytes, for putting it back in the
   * composer. Another client's queued message arrives with thumbnails only, and
   * resending those would send the thumbnail as the picture.
   */
  originalAttachments(message: ChatMessage): Promise<ImageAttachment[]> {
    return Promise.all((message.attachments ?? []).map((attachment) => attachment.preview
      ? this.originalAttachment(message.id, { name: attachment.name, ...(attachment.id ? { attachmentId: attachment.id } : {}) })
      : attachment))
  }

  /** An attachment with its original bytes, memoised like `loadAttachment`. */
  async originalAttachment(messageId: string, ref: { attachmentId?: string; name: string }): Promise<ImageAttachment> {
    const key = `${messageId}:${ref.attachmentId ?? ref.name}`
    const cached = this.attachmentBytes.get(key)
    if (cached) return cached
    const result = await this.read<{ attachment?: ImageAttachment }>('session.attachment', { messageId, ...ref })
    if (!result.attachment?.base64) throw new Error('attachment unavailable')
    this.attachmentBytes.set(key, result.attachment)
    return result.attachment
  }
  private readonly attachmentBytes = new Map<string, ImageAttachment>()

  async loadSystemInfo(provider: string = String(this.provider)): Promise<SystemInfo> {
    if (!this.projectPath) return {}
    const info = await requestHarnessResource(this.client, 'get_system_info', this.projectPath, provider) as SystemInfo

    this.provider = provider
    this.permissionModes = info.permissionModes ?? info.permissionPresets ?? []
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
    this.widgetComposers.dispose()
    this.inputRequestSends.clear()
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
      messages: this.session.messages.filter((message) =>
        (!message.status || message.status === 'complete') && !message.metadata?.sendFailure),
      provider: String(this.provider),
      hasMore: this.hasMoreHistory,
      cursor: this.historyCursor,
      navigationAvailable: this.navigationAvailable,
      ...(this.appContexts.snapshot() ? { mcpAppContexts: this.appContexts.snapshot() } : {}),
    })
  }

  send(content: string, extra: SendMessageOptions = {}): void {
    const clientMessageId = extra.clientMessageId ?? newMessageId('user')
    const message = localUserMessage(clientMessageId, content, extra.images, extra.userMessageContent)
    const inputRequest = extra.inputRequest && this.session.pendingPermissions.find(request => request.requestId === extra.inputRequest!.requestId)
    if (inputRequest) this.inputRequestSends.capture(clientMessageId, inputRequest)
    const cmd: SendMessageCommand = {
      ...this.sessionRef(),
      text: content,
      userMessageContent: message.content,
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.effort ? { effort: extra.effort } : {}),
      ...(extra.collaborationMode ? { collaborationMode: extra.collaborationMode } : {}),
      ...(extra.images?.length ? { images: extra.images } : {}),
      ...(extra.agent ? { agent: extra.agent } : {}),
      ...(extra.serviceTier !== undefined ? { serviceTier: extra.serviceTier } : {}),
      ...(extra.modelParams && Object.keys(extra.modelParams).length
        ? { modelParams: extra.modelParams }
        : {}),
      ...(extra.ultracode !== undefined ? { ultracode: extra.ultracode } : {}),
      clientMessageId,
      ...(extra.inputRequest ? { inputRequest: extra.inputRequest } : {}),
      ...(extra.priority ? { priority: extra.priority } : {}),
      ...(extra.steer ? { steer: extra.steer } : {}),
    }
    // The wire messages that report this command's output carry no name, so the
    // only chance to learn it is here, from what the user actually sent.
    const queued = extra.priority === 'next'
      ? message
      : null
    this.session = {
      ...this.session,
      ...(inputRequest ? { pendingPermissions: this.session.pendingPermissions.filter(request => request.requestId !== inputRequest.requestId) } : {}),
      _pendingSlashCommand: pendingSlashCommandFrom(content),
      // Same rule as the desktop composer: the boundary reducer drops this bubble
      // and the turn's blank reply instead of leaving "/compact" in the transcript.
      ...(!queued && isCompactSlashSend(this.provider as HarnessId, content) ? { _pendingCompactUserId: clientMessageId } : {}),
      ...(queued ? { queuedMessages: [...this.session.queuedMessages, queued] } : {}),
    }
    // A live send paints its own bubble, as the desktop does: the host echoes
    // it back under the same id, which the reducer then ignores as a duplicate.
    if (!queued) this.appendLocalTurn(message)
    this.dirty = true
    this.flush()
    void this.deliver(cmd)
  }

  /**
   * Wait for the host's receipt. Without one a text send that the host refused,
   * or never saw, leaves "Sending…" spinning with nothing to act on.
   */
  private async deliver(cmd: SendMessageCommand): Promise<void> {
    const generation = this.restoreGeneration
    try {
      const { environmentId, sessionId, ultracode, ...payload } = cmd
      const result = await this.client.controlledRpc({ environmentId, sessionId }, 'session.send', { ...payload, ...(ultracode !== undefined ? { options: { ultracode } } : {}) })
      if (generation === this.restoreGeneration && cmd.clientMessageId) {
        this.inputRequestSends.complete(cmd.clientMessageId)
        // The host already has this id (a stale Resend): nothing new will answer it.
        const duplicate = isDuplicateSend(result)
        if (duplicate) this.session = { ...this.session, awaitingAssistantReply: false }
        if (cmd.inputRequest || duplicate) { this.dirty = true; this.flush() }
      }
    } catch (error) {
      if (generation !== this.restoreGeneration || !cmd.clientMessageId) return
      const errorText = error instanceof Error ? error.message : String(error)
      const restored = this.inputRequestSends.reject(this.session, cmd.clientMessageId, errorText, cmd.priority === 'next')
      if (restored) { this.session = { ...this.session, ...restored }; this.dirty = true; this.flush(); return }
      if (!parseInputRequestError(errorText)) this.failedSends.set(cmd.clientMessageId, cmd)
      else this.inputRequestSends.complete(cmd.clientMessageId)
      this.ingest([{
        type: 'user_message_send_failed',
        clientMessageId: cmd.clientMessageId,
        error: error instanceof Error ? error.message : String(error),
      }])
    }
  }

  /**
   * Resend a failed message exactly as it originally went out. A failure the
   * host recorded after taking the message (or one from before a restore) left
   * no command behind; the transcript row is resent under its own id instead.
   */
  async resendFailedMessage(clientMessageId: string): Promise<void> {
    const cmd = this.failedSends.get(clientMessageId) ?? await this.resendCommandFromTranscript(clientMessageId)
    if (!cmd || !this.session.messages.some((message) => message.id === clientMessageId && message.metadata?.sendFailure)) return
    this.failedSends.delete(clientMessageId)
    this.session = {
      ...this.session,
      messages: this.session.messages.map((message) =>
        message.id === clientMessageId ? withoutSendFailure(message) : message),
      ...(cmd.priority === 'next' ? {} : { awaitingAssistantReply: true }),
    }
    this.dirty = true
    this.flush()
    void this.deliver(cmd)
  }

  private async resendCommandFromTranscript(clientMessageId: string): Promise<SendMessageCommand | null> {
    const message = this.session.messages.find((item) => item.id === clientMessageId)
    const fromRow = message ? failedMessageResend(message) : null
    if (!message || !fromRow) return null
    const { images: _, content, ...resend } = fromRow
    // The transcript may hold thumbnails only; the turn needs the originals.
    const images = await this.originalAttachments(message)
    return {
      ...this.sessionRef(), ...resend, text: content, ...(images.length ? { images } : {}),
    }
  }

  /** Drop a failed message from the transcript; the caller puts it back into the composer. */
  takeFailedMessage(clientMessageId: string): ChatMessage | null {
    const message = this.session.messages.find((item) => item.id === clientMessageId)
    if (!message?.metadata?.sendFailure) return null
    this.failedSends.delete(clientMessageId)
    this.session = { ...this.session, messages: this.session.messages.filter((item) => item !== message) }
    this.dirty = true
    this.flush()
    return message
  }

  /**
   * Paint the first bubble before the host has a session to send it to. The
   * `send()` that follows `create()` reuses the id, so nothing is drawn twice.
   */
  stageTurn(clientMessageId: string, content: string, images?: ImageAttachment[], userMessageContent?: SendMessageOptions['userMessageContent']): void {
    this.appendLocalTurn(localUserMessage(clientMessageId, content, images, userMessageContent))
    this.dirty = true
    this.flush()
  }

  private appendLocalTurn(message: ChatMessage): void {
    this.session = {
      ...this.session,
      ...(this.session.messages.some((item) => item.id === message.id)
        ? {}
        : { messages: [...this.session.messages, message] }),
      awaitingAssistantReply: true,
    }
  }

  /** What the transcript shows under a turn the host has not started answering. */
  get pendingTurn(): 'creating' | 'sending' | null {
    if (!this.session.awaitingAssistantReply) return null
    return this.creating || !this.sessionId ? 'creating' : 'sending'
  }

  async dequeueMessage(clientMessageId: string): Promise<boolean> {
    const generation = this.restoreGeneration
    const result = await this.control<{ removed: boolean }>('session.dequeue', { clientMessageId })
    if (!result.removed || generation !== this.restoreGeneration) return false
    this.session = {
      ...this.session,
      queuedMessages: this.session.queuedMessages.filter((message) => message.id !== clientMessageId),
    }
    this.dirty = true
    this.flush()
    return true
  }

  async steerQueuedMessage(clientMessageId: string, priority: 'now' | 'next' = 'now'): Promise<boolean> {
    if (!this.sessionId || !this.projectPath) return false
    const result = await this.control<{ ok: boolean }>('session.steer', { clientMessageId, priority })
    return result.ok
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
      const result = await this.control<{ ok: boolean }>('session.recap')
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
   * Session goal for an `rpc`-transport harness (Codex). Harnesses whose goal is
   * a `slash` command need none of this: their lifecycle is an ordinary turn, so
   * the composer sends `/goal …` through {@link send}.
   *
   * Nothing is painted optimistically — the host answers every transition with a
   * `session_goal` event, and inventing a chip here would mean guessing at a
   * status the app server owns.
   */
  async setSessionGoal(objective: string, status?: CodexGoalStatus): Promise<void> {
    await this.control('session.setGoal', { objective, ...(status ? { status } : {}) })
  }

  async clearSessionGoal(): Promise<void> {
    await this.control('session.setGoal', { objective: null })
  }

  /**
   * Take an achieved goal off the composer.
   *
   * Local only, and correct for every harness: a goal reaches `complete` because
   * the harness met it and cleared its own copy, so there is nothing left to
   * send and no later event that would bring this one back.
   */
  dismissGoal(): void {
    if (!this.session.sessionGoal) return
    this.session = { ...this.session, sessionGoal: null }
    this.dirty = true
    this.flush()
  }

  /**
   * Live model / effort / mode change on a running session — the same write the
   * desktop selector performs. A draft session carries its picks in `create`.
   */
  setSessionSettings(settings: { model?: string; effort?: string; mode?: string; agentPreset?: string }): void {
    if (!this.sessionId || !this.projectPath) return
    this.command('session.patchSettings', { settings })
  }

  setSessionApiProviderId(apiProviderId: string | null): void {
    if (!this.sessionId || !this.projectPath) return
    this.command('session.patchSettings', { settings: { apiProviderId } })
  }

  async answerCodexAsyncQuestion(messageId: string, itemId: string, answers: string[]): Promise<void> {
    const { projectPath, sessionId } = this
    if (!projectPath || !sessionId) throw new Error('No active session')
    if (!this.session.messages.some(message => message.id === messageId)) throw new Error('Question session is no longer active')
    const result = await this.control<{ reply: string }>('session.answerAsyncQuestion', { messageId, itemId, answers })
    if (typeof result.reply !== 'string') throw new Error('Answer was not accepted')
    if (this.sessionId !== sessionId || this.projectPath !== projectPath) return
    this.ingest([{ type: 'user_message_appended', message: {
      id: codexAsyncAnswerId(itemId), role: 'user', status: 'complete', providerId: 'codex',
      createdAt: new Date().toISOString(), content: [{ type: 'text', text: result.reply }],
    } }])
    this.flush()
  }

  interrupt(): void {
    // Stop before the reply started: nothing will come back to clear the
    // pending line, so drop it here — the desktop store does the same.
    if (this.session.awaitingAssistantReply) {
      this.session = { ...this.session, awaitingAssistantReply: false }
      this.dirty = true
      this.flush()
    }
    this.command('session.interrupt')
  }

  setPermissionMode(mode: string): void {
    this.session.permissionMode = mode as SessionState['permissionMode']
    this.command('session.patchSettings', { settings: { permissionMode: mode } })
  }

  /**
   * Optimistic so the chip answers the tap, then reconciled against what the host
   * actually applied — a host that cannot sandbox (no bubblewrap on Linux) rejects
   * the change, and the guess would otherwise claim a confinement that is not there.
   */
  async setSandboxMode(mode: SandboxMode): Promise<void> {
    if (!this.sessionId || !this.projectPath) return
    const previous = this.sandboxInfo
    this.sandboxInfo = sandboxInfoFromMode(mode)
    this.dirty = true
    this.flush()
    const session = this.sessionRef(), generation = this.restoreGeneration
    let failure: unknown
    try { await this.client.controlledRpc(session, 'session.patchSettings', { settings: { sandboxMode: mode } }) }
    catch (error) { failure = error }
    try {
      const loaded = await readRuntimeSession<SessionLoadResult>(this.client, session, 'session.load', { limit: 1 })
      if (generation === this.restoreGeneration) {
        this.sandboxInfo = loaded.restore?.sandboxInfo ?? null
        this.dirty = true
        this.flush()
      }
    } catch (error) {
      if (generation === this.restoreGeneration) {
        this.sandboxInfo = previous
        this.dirty = true
        this.flush()
      }
      if (!failure) failure = error
    }
    if (failure) throw failure
  }

  /** Save the widget the phone is looking at into the host's template store. */
  async saveWidgetTemplate(input: SaveWidgetTemplateRequest): Promise<void> {
    const project = await this.client.resolveProject(this.projectPath)
    await this.client.rpc('widget.saveTemplate', { projectId: project.projectId, input }, { environmentId: project.environmentId })
  }

  searchMentions(query: string, options?: MentionSearchOptions): Promise<MentionSearchResult> {
    return requestMentionSearch(this.client, this.projectPath, query, options)
  }

  /** Root the composer browses: a worktree session is not the project folder. */
  get mentionRoot(): string {
    return this.worktree.worktreePath || this.projectPath
  }

  private readonly answering = new Set<string>()

  async respondPermission(
    requestId: string,
    decision: boolean,
    formAnswers?: Record<string, unknown>,
    alwaysAllow?: boolean,
    reason?: string,
    selectedSuggestions?: number[],
  ): Promise<void> {
    if (this.resolvedPermissionIds.has(requestId) || this.answering.has(requestId)) return
    const generation = this.restoreGeneration
    const pending = this.session.pendingPermissions.find(request => request.requestId === requestId)
    const receipt = this.control('session.respondPermission', {
      interactionId: requestId, decision: decision ? (alwaysAllow ? 'allow_always' : 'allow') : 'deny',
      ...(reason ? { reason } : {}), ...(selectedSuggestions?.length ? { selectedSuggestions } : {}),
      ...(formAnswers ? { formAnswers } : {}),
    })
    this.answering.add(requestId)
    if (pending?.requestKind !== 'input_request') {
      this.ingest([{ type: 'interaction_resolved', interactionType: 'permission', requestId }])
      this.flush()
    }
    try { await receipt }
    catch (error) {
      if (generation === this.restoreGeneration && pending && !this.session.pendingPermissions.some(item => item.requestId === requestId)) {
        this.resolvedPermissionIds.delete(requestId)
        this.session = { ...this.session, pendingPermissions: [...this.session.pendingPermissions, pending] }
        this.dirty = true
        this.flush()
      }
      throw error
    } finally { this.answering.delete(requestId) }
  }

  async respondPlan(requestId: string, approved: boolean, feedback?: string): Promise<void> {
    await this.control('session.respondPlan', { interactionId: requestId, decision: approved ? 'approve' : 'reject', options: { ...(feedback ? { feedback } : {}) } })
  }

  async respondCodexPlan(messageId: string, status: 'approved' | 'rejected', feedback?: string): Promise<void> {
    await this.control('session.respondPlan', { interactionId: messageId, decision: status === 'approved' ? 'approve' : 'reject', options: { messageId, ...(feedback ? { feedback } : {}) } })
  }

  async answerQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): Promise<void> {
    await this.questionResponse(requestId, { answers, ...(annotations ? { annotations } : {}) })
  }

  async dismissQuestion(requestId: string): Promise<void> {
    await this.questionResponse(requestId, { dismiss: true })
  }

  private async questionResponse(requestId: string, response: Record<string, unknown>): Promise<void> {
    if (this.resolvedQuestionIds.has(requestId)) return
    const generation = this.restoreGeneration
    const pending = this.session.pendingQuestion
    const receipt = this.control('session.respondQuestion', { interactionId: requestId, ...response })
    this.ingest([{ type: 'interaction_resolved', interactionType: 'question', requestId }])
    this.flush()
    try { await receipt }
    catch (error) {
      if (generation === this.restoreGeneration && pending?.requestId === requestId) {
        this.resolvedQuestionIds.delete(requestId)
        if (!this.session.pendingQuestion) {
          this.session = { ...this.session, pendingQuestion: pending }
          this.dirty = true
          this.flush()
        }
      }
      throw error
    }
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
    if (event.environmentId && event.environmentId !== this.sourceEnvironmentId) return
    if (event.sessionId && event.sessionId !== this.sessionId) return
    if (event.type === 'remote_command_error') { this.hooks.onCommandError?.(event.message); return }
    if (event.type === 'user_message_send_failed') {
      const queued = this.session.queuedMessages.some(message => message.id === event.clientMessageId)
      const restored = this.inputRequestSends.reject(this.session, event.clientMessageId, event.error, queued)
      if (restored) {
        this.failedSends.delete(event.clientMessageId)
        this.session = { ...this.session, ...restored }; this.dirty = true
        return
      }
    }
    // Another client's Resend went through; the one held here is stale.
    if (event.type === 'user_message_send_retried') this.failedSends.delete(event.clientMessageId)
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
    if (event.type === 'interaction_resolved' && event.interactionType === 'permission') {
      this.resolvedPermissionIds.add(event.requestId)
    }
    if (event.type === 'permission_request' && this.resolvedPermissionIds.has(event.request.requestId)) return false
    return !(event.type === 'ask_user_question' && this.resolvedQuestionIds.has(event.request.requestId))
  }

  /**
   * Session state the chat reducer does not carry. Runs on the restore replay too,
   * which bypasses `apply()` — miss that and a resumed session shows the sandbox
   * the snapshot reported instead of the one a later event corrected it to.
   */
  private captureRuntimeFacts(event: AgentEvent, messages = this.session.messages): void {
    this.appContexts.capture(event, messages)
    if (event.type === 'init_ready') this.sandboxInfo = event.sandboxInfo
    if (event.type === 'agent_setting_change' && event.patch?.sandboxInfo) {
      this.sandboxInfo = event.patch.sandboxInfo
    }
  }

  private handleSideEvent(event: AgentEvent): boolean {
    if (this.widgetComposers.consume(event)) return true
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
