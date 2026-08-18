import type { Part } from '@opencode-ai/sdk/v2'
import type {
  AgentEvent,
  AskUserQuestionRequest,
  ContextUsageInfo,
  McpServerInfo,
  MessageMetadata,
  PermissionMode,
  PermissionRequest,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import log from '../../logger'
import { DEADLINE_EXCEEDED, INTERRUPT_CANCEL_TIMEOUT_MS, withDeadline } from '../../promise-deadline'
import { resolveComputerUseGrant, rejectComputerUseGrant } from '../../computer-use/grant-request'
import { dispatchOpenCodeRequest } from '../../opencode/opencode-command'
import {
  commonPrefixLength,
  mapOpenCodeTodos,
  mapOpenCodePermissionRequest,
  mapOpenCodeQuestionRequest,
  openCodeAssistantMetadata,
  openCodeErrorMessage,
  openCodeToolName,
  readOpenCodeConfig,
  routeOpenCodeTodoEvent,
  textFromOpenCodePart,
} from '../../opencode/opencode-event-map'
import {
  createOpenCodeRuntime,
  type OpenCodeRuntime,
  type OpenCodeRuntimeConfig,
  type OpenCodeRuntimeEvent,
  type OpenCodeRuntimeOptions,
} from '../../opencode/opencode-runtime'
import {
  TaskNotificationFlush,
  TaskNotificationQueue,
  taskNotificationRequest,
} from '../task-notification-queue'
import { QueuedUserMessageQueue } from '../queued-user-message-queue'
import type { BackendStartOptions, HarnessId, SessionBackend, TaskNotificationInjectResult } from '../types'

type OpenCodeRuntimeFactory = (opts: OpenCodeRuntimeOptions) => Promise<OpenCodeRuntime>

let runtimeFactory: OpenCodeRuntimeFactory = createOpenCodeRuntime

export function setOpenCodeRuntimeFactory(factory: OpenCodeRuntimeFactory | null): void {
  runtimeFactory = factory ?? createOpenCodeRuntime
}

export class OpenCodeBackend implements SessionBackend {
  readonly kind: HarnessId = 'opencode'
  private runtime: OpenCodeRuntime | null = null
  private runtimePromise: Promise<OpenCodeRuntime> | null = null
  private runtimeAbortController: AbortController | null = null
  private runtimeEpoch = 0
  private opts: BackendStartOptions | null = null
  private config: OpenCodeRuntimeConfig = {}
  private permissionMode: PermissionMode = 'default'
  private started = false
  private disposed = false
  private interrupted = false
  private currentMessageId: string | null = null
  private activeTurn: { messageId: string; resolve: () => void } | null = null
  /** OpenCode has no steer — mid-turn user messages run as their own turn afterwards. */
  private readonly pendingQueued = new QueuedUserMessageQueue({
    isBusy: () => this.isTurnBusy(),
    isAlive: () => this.started && !this.disposed,
    emit: (event) => this.emit(event),
    send: (request) => this.send(request),
    warn: (message, err) => log.warn(`[OpenCodeBackend] ${message}:`, err),
  })
  private readonly pendingTaskNotifications = new TaskNotificationQueue()
  /** Overridden by Session → Session.send / _sendChain for idle flushes. */
  private taskNotificationSender: (content: string) => Promise<void> = (content) =>
    this.send(taskNotificationRequest(content))
  private readonly taskNotificationFlush = new TaskNotificationFlush(
    this.pendingTaskNotifications,
    {
      isBusy: () => Boolean(this.activeTurn),
      isAlive: () => this.started && !this.disposed,
      send: (content) => this.taskNotificationSender(content),
    },
    {
      logLabel: 'OpenCodeBackend',
      warn: (message) => log.warn(message),
    },
  )
  private terminalMessageId: string | null = null
  private messageRoleById = new Map<string, 'user' | 'assistant'>()
  private partById = new Map<string, Part>()
  private emittedTextByPartId = new Map<string, string>()
  private completedToolIds = new Set<string>()
  private capturedUserMessageIds = new Set<string>()
  private latestMetadata: MessageMetadata | undefined
  private lastContextTokens = 0
  private activeCompaction: { preTokens: number; startedAt: number } | null = null
  private pendingPermissions = new Map<string, { request: PermissionRequest; event: AgentEvent }>()
  private pendingQuestions = new Map<string, { request: AskUserQuestionRequest; event: AgentEvent }>()
  private listeners = new Set<(event: AgentEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private permissionModeListeners = new Set<(mode: PermissionMode) => void>()

  hasActiveRuntime(): boolean {
    return Boolean(this.runtime || this.runtimePromise)
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {
    if (this.activeTurn || this.pendingQueued.size > 0) return
    if (this.getPendingInteractions().length > 0) return
    await this.closeRuntime()
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.disposed) throw new Error('OpenCodeBackend already disposed')
    this.opts = opts
    this.config = readOpenCodeConfig(opts.config)
    this.permissionMode = opts.permissionMode
    this.started = true
    try {
      await this.ensureRuntime()
    } catch (error) {
      this.started = false
      throw error
    }
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.closeRuntime()
    this.disposed = false
    this.started = false
    await this.start(opts)
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.disposed) return
    this.opts = opts
    this.config = readOpenCodeConfig(opts.config)
    this.permissionMode = opts.permissionMode
    void this.ensureRuntime().catch((error) => log.debug('[OpenCodeBackend] prewarm failed:', error))
  }

  private async ensureRuntime(): Promise<OpenCodeRuntime> {
    if (this.runtime) return this.runtime
    if (this.runtimePromise) return this.runtimePromise
    if (!this.opts) throw new Error('OpenCodeBackend not configured')
    const epoch = this.runtimeEpoch
    const abortController = new AbortController()
    this.runtimeAbortController = abortController
    const opts = this.opts
    const promise = runtimeFactory({
      signal: abortController.signal,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      providerSessionId: opts.providerSessionId,
      permissionMode: this.permissionMode,
      config: this.config,
      systemPromptAppend: opts.systemPromptAppend,
      onEvent: (event) => this.routeEvent(event),
    }).then(async (runtime) => {
      if (this.disposed || epoch !== this.runtimeEpoch) {
        await runtime.close().catch(() => undefined)
        throw new Error('OpenCode runtime initialization was superseded')
      }
      this.runtime = runtime
      opts.providerSessionId = runtime.sessionId
      for (const callback of this.providerSessionListeners) callback(runtime.sessionId)
      this.emit({ type: 'provider_session_id', providerSessionId: runtime.sessionId })
      this.emit(mapOpenCodeTodos(runtime.initialTodos))
      for (const request of runtime.pendingPermissions) {
        this.routeEvent({ id: `snapshot-${request.id}`, type: 'permission.v2.asked', properties: request })
      }
      for (const request of runtime.pendingQuestions) {
        this.routeEvent({ id: `snapshot-${request.id}`, type: 'question.v2.asked', properties: request })
      }
      return runtime
    }).finally(() => {
      if (this.runtimePromise === promise) this.runtimePromise = null
      if (this.runtimeAbortController === abortController) this.runtimeAbortController = null
    })
    this.runtimePromise = promise
    return promise
  }

  bindTaskNotificationSend(send: (content: string) => Promise<void>): void {
    this.taskNotificationSender = send
  }

  /**
   * Mid-turn queue only. Idle synthetic turns are owned by Session.send.
   * OpenCode has no mid-turn inject API.
   */
  async injectTaskNotification(content: string): Promise<TaskNotificationInjectResult> {
    if (!this.started || this.disposed) return 'deferred'
    const text = content.trim()
    if (!text) return 'deferred'
    if (this.activeTurn) {
      this.pendingTaskNotifications.enqueue(text)
      return 'deferred'
    }
    return 'unhandled'
  }

  private flushPendingTaskNotifications(): void {
    this.taskNotificationFlush.flush()
  }

  /**
   * Busy from the first synchronous line of `send()`, so a queued message cannot
   * slip into the window before `await ensureRuntime()` assigns `activeTurn`.
   */
  private isTurnBusy(): boolean {
    return this.currentMessageId !== null || this.activeTurn !== null
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('OpenCodeBackend not started')
    if (this.pendingQueued.intercept(request)) return
    if (this.activeTurn) throw new Error('OpenCodeBackend already has an active turn')
    const messageId = request.assistantMessageId ?? `opencode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.resetTurnState()
    this.currentMessageId = messageId
    this.interrupted = false
    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'opencode',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })
    try {
      const runtime = await this.ensureRuntime()
      const turnComplete = new Promise<void>((resolve) => { this.activeTurn = { messageId, resolve } })
      if (request.content.trim() === '/compact') {
        const usage = await runtime.getContextUsage().catch(() => null)
        this.activeCompaction = { preTokens: usage?.totalTokens ?? this.lastContextTokens, startedAt: Date.now() }
        this.emit({ type: 'status_indicator', indicator: 'compacting' })
      }
      const dispatch = await dispatchOpenCodeRequest(runtime, request)
      if (dispatch.kind === 'local') {
        this.emit({ type: 'slash_command_output', messageId, content: dispatch.content })
        this.complete(messageId)
      }
      await turnComplete
    } catch (error) {
      if (this.activeCompaction) {
        this.activeCompaction = null
        this.emit({
          type: 'status_indicator',
          indicator: null,
          compactResult: 'failed',
          compactError: error instanceof Error ? error.message : String(error),
        })
      }
      if (this.interrupted) this.complete(messageId, true)
      else this.fail(messageId, error instanceof Error ? error.message : String(error))
    } finally {
      const activeTurn = this.activeTurn as { messageId: string; resolve: () => void } | null
      if (activeTurn?.messageId === messageId) this.activeTurn = null
      this.currentMessageId = null
      this.resetTurnState()
      // User-typed messages outrank host task notifications.
      this.pendingQueued.flush()
      this.flushPendingTaskNotifications()
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    this.pendingQueued.clear()
    for (const requestId of [...this.pendingPermissions.keys()]) this.respondToPermission(requestId, false)
    for (const requestId of [...this.pendingQuestions.keys()]) this.dismissQuestion(requestId)
    // The terminal event below is what releases the UI, so the provider cancel
    // must never be able to hold it hostage.
    const cancelled = this.runtime
      ? await withDeadline(
        this.runtime.cancel().catch((error) => log.debug('[OpenCodeBackend] interrupt failed:', error)),
        INTERRUPT_CANCEL_TIMEOUT_MS,
      )
      : undefined
    if (cancelled === DEADLINE_EXCEEDED) {
      log.warn('[OpenCodeBackend] runtime.cancel() did not answer within %dms; settling the turn locally', INTERRUPT_CANCEL_TIMEOUT_MS)
    }
    if (this.currentMessageId) this.complete(this.currentMessageId, true)
  }

  private async closeRuntime(): Promise<void> {
    this.runtimeEpoch += 1
    const pending = this.runtimePromise
    const abortController = this.runtimeAbortController
    const runtime = this.runtime
    this.runtimePromise = null
    this.runtimeAbortController = null
    this.runtime = null
    this.pendingPermissions.clear()
    this.pendingQuestions.clear()
    abortController?.abort()
    if (runtime) await runtime.close().catch((error) => log.debug('[OpenCodeBackend] runtime close failed:', error))
    if (pending) await pending.catch(() => null)
  }

  private invalidateRuntime(): void {
    const runtime = this.runtime
    this.runtime = null
    this.runtimeEpoch += 1
    if (runtime) void runtime.close().catch((error) => log.debug('[OpenCodeBackend] invalid runtime close failed:', error))
  }

  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    this.taskNotificationFlush.dispose()
    if (this.currentMessageId) this.complete(this.currentMessageId, true)
    await this.closeRuntime()
    this.listeners.clear()
    this.providerSessionListeners.clear()
    this.permissionModeListeners.clear()
  }

  async setModel(model: string): Promise<void> {
    if (this.opts) this.opts.model = model
    await this.runtime?.setModel(model)
  }

  async setTitle(title: string): Promise<void> {
    await this.runtime?.setTitle(title)
  }

  async setSessionMode(_modeId: string): Promise<void> {}

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionMode = mode
    if (this.opts) this.opts.permissionMode = mode
    if (this.runtime) await this.runtime.setPermissionMode(mode)
    for (const callback of this.permissionModeListeners) callback(mode)
  }

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow = false,
    _reason?: string,
    _selectedSuggestions?: number[],
    decision?: 'cancel',
  ): boolean {
    if (decision === 'cancel') {
      if (rejectComputerUseGrant(requestId, 'User cancelled')) return true
    }
    if (resolveComputerUseGrant(requestId, allow, alwaysAllow)) return true
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return false
    this.pendingPermissions.delete(requestId)
    const reply = decision === 'cancel' || !allow ? 'reject' : alwaysAllow ? 'always' : 'once'
    void this.runtime?.permissionReply(requestId, reply).catch((error) => {
      if (this.currentMessageId) this.fail(this.currentMessageId, openCodeErrorMessage(error))
    })
    this.emit({ type: 'interaction_resolved', interactionType: 'permission', requestId, approved: reply !== 'reject' })
    return true
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, _annotations?: QuestionAnnotations): void {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return
    this.pendingQuestions.delete(requestId)
    const values = pending.request.questions.map((question) => {
      const value = answers[question.question] ?? answers[question.header] ?? ''
      return question.multiSelect
        ? value.split(', ').map((item) => item.trim()).filter(Boolean)
        : value ? [value] : []
    })
    void this.runtime?.questionReply(requestId, values).catch((error) => {
      if (this.currentMessageId) this.fail(this.currentMessageId, openCodeErrorMessage(error))
    })
    this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
  }

  dismissQuestion(requestId: string): void {
    if (!this.pendingQuestions.delete(requestId)) return
    void this.runtime?.questionReject(requestId).catch((error) => log.debug('[OpenCodeBackend] question reject failed:', error))
    this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
  }

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {}
  async getContextUsage(): Promise<ContextUsageInfo | null> {
    try {
      return await (await this.ensureRuntime()).getContextUsage()
    } catch {
      return null
    }
  }
  async getMcpServerStatus(): Promise<McpServerInfo[]> { return (await this.ensureRuntime()).getMcpServerStatus() }
  async authenticateMcp(serverName: string): Promise<void> { await (await this.ensureRuntime()).authenticateMcp(serverName) }
  async rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    try {
      const runtime = await this.ensureRuntime()
      const changes = await runtime.diff(userMessageId)
      const result: RewindFilesResult = {
        canRewind: true,
        supportsCodeOnly: false,
        filesChanged: changes.flatMap((change) => change.file ? [change.file] : []),
        insertions: changes.reduce((total, change) => total + change.additions, 0),
        deletions: changes.reduce((total, change) => total + change.deletions, 0),
      }
      if (!opts?.dryRun) await runtime.revert(userMessageId)
      return result
    } catch (error) {
      return { canRewind: false, error: openCodeErrorMessage(error) }
    }
  }
  async reconnectMcp(serverName: string): Promise<void> { await (await this.ensureRuntime()).reconnectMcp(serverName) }
  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> { await (await this.ensureRuntime()).toggleMcpServer(serverName, enabled) }
  async reloadMcpServers(): Promise<void> { await (await this.ensureRuntime()).reloadMcpServers() }
  async reloadPlugins(): Promise<boolean> { return false }
  dequeueMessage(clientMessageId: string): boolean {
    return this.pendingQueued.dequeue(clientMessageId)
  }
  getPendingInteractions(): AgentEvent[] {
    return [...this.pendingPermissions.values(), ...this.pendingQuestions.values()].map((entry) => entry.event)
  }
  onEvent(handler: (event: AgentEvent) => void): () => void { this.listeners.add(handler); return () => this.listeners.delete(handler) }
  onProviderSessionId(handler: (id: string) => void): () => void { this.providerSessionListeners.add(handler); return () => this.providerSessionListeners.delete(handler) }
  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void { this.permissionModeListeners.add(handler); return () => this.permissionModeListeners.delete(handler) }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private resetTurnState(): void {
    this.terminalMessageId = null
    this.messageRoleById.clear()
    this.partById.clear()
    this.emittedTextByPartId.clear()
    this.completedToolIds.clear()
    this.capturedUserMessageIds.clear()
    this.latestMetadata = undefined
  }

  private complete(messageId: string, interrupted = false): void {
    if (this.terminalMessageId === messageId) return
    this.terminalMessageId = messageId
    this.emit({
      type: interrupted ? 'message_interrupted' : 'message_complete',
      messageId,
      ...(interrupted || !this.latestMetadata ? {} : { metadata: this.latestMetadata }),
    })
    this.emit({ type: 'status_change', status: 'idle' })
    if (this.activeTurn?.messageId === messageId) this.activeTurn.resolve()
  }

  private fail(messageId: string, error: string): void {
    if (this.terminalMessageId === messageId) return
    this.terminalMessageId = messageId
    this.emit({ type: 'message_error', messageId, error })
    this.emit({ type: 'status_change', status: 'error' })
    if (this.activeTurn?.messageId === messageId) this.activeTurn.resolve()
  }

  private roleForPart(part: Part): 'user' | 'assistant' | undefined {
    return this.messageRoleById.get(part.messageID) ?? (part.type === 'tool' ? 'assistant' : undefined)
  }

  private emitTextSnapshot(part: Part, messageId: string): void {
    const text = textFromOpenCodePart(part)
    if (text === undefined || this.roleForPart(part) !== 'assistant') return
    const previous = this.emittedTextByPartId.get(part.id) ?? ''
    const latest = previous.length > text.length && previous.startsWith(text) ? previous : text
    const delta = latest.slice(commonPrefixLength(previous, latest))
    this.emittedTextByPartId.set(part.id, latest)
    if (!delta) return
    this.emit({
      type: 'content_delta',
      messageId,
      delta: part.type === 'reasoning'
        ? { type: 'thinking', thinking: delta, startedAt: part.time.start, endedAt: part.time.end }
        : { type: 'text', text: delta },
    })
  }

  private emitTool(part: Extract<Part, { type: 'tool' }>, messageId: string): void {
    const status = part.state.status === 'completed' || part.state.status === 'error' ? 'complete' : 'streaming'
    const input = 'input' in part.state ? JSON.stringify(part.state.input) : '{}'
    this.emit({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_use',
        toolName: openCodeToolName(part.tool),
        toolUseId: part.callID,
        input,
        status,
        ...('time' in part.state && part.state.time.start ? { startedAt: part.state.time.start } : {}),
      },
    })
    if (status !== 'complete' || this.completedToolIds.has(part.callID)) return
    this.completedToolIds.add(part.callID)
    const summary = part.state.status === 'completed'
      ? part.state.output
      : part.state.status === 'error' ? part.state.error : ''
    this.emit({
      type: 'content_delta',
      messageId,
      delta: {
        type: 'tool_result',
        toolUseId: part.callID,
        summary,
        isError: part.state.status === 'error',
      },
    })
  }

  private routeEvent(event: OpenCodeRuntimeEvent): void {
    const messageId = this.currentMessageId
    if (event.type === 'runtime.error') {
      if (messageId) this.fail(messageId, event.properties.message)
      else this.emit({ type: 'status_change', status: 'error' })
      this.invalidateRuntime()
      return
    }
    if (routeOpenCodeTodoEvent(event, (item) => this.emit(item))) return

    if (event.type === 'message.updated') {
      const info = event.properties.info
      this.messageRoleById.set(info.id, info.role)
      if (info.role === 'user' && messageId && !this.capturedUserMessageIds.has(info.id)) {
        this.capturedUserMessageIds.add(info.id)
        this.emit({
          type: 'checkpoint_captured',
          messageId,
          checkpointId: info.id,
          resumePointId: info.id,
        })
      }
      if (info.role === 'assistant' && messageId) {
        this.latestMetadata = openCodeAssistantMetadata(info)
        const total = info.tokens.total
          ?? info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cache.read + info.tokens.cache.write
        this.emit({
          type: 'message_usage',
          messageId,
          inputTokens: info.tokens.input + info.tokens.cache.read + info.tokens.cache.write,
          outputTokens: info.tokens.output + info.tokens.reasoning,
          contextTokens: total,
          contextWindow: this.runtime?.models.find(
            (model) => model.id === `${info.providerID}/${info.modelID}`,
          )?.contextWindow,
          costUsd: info.cost,
        })
        this.lastContextTokens = total
        for (const part of this.partById.values()) {
          if (part.messageID === info.id) this.emitTextSnapshot(part, messageId)
        }
      }
      return
    }

    if (event.type === 'message.removed') {
      this.messageRoleById.delete(event.properties.messageID)
      return
    }

    if (event.type === 'message.part.updated' && messageId) {
      const part = event.properties.part
      this.partById.set(part.id, part)
      this.emitTextSnapshot(part, messageId)
      if (part.type === 'tool' && this.roleForPart(part) === 'assistant') this.emitTool(part, messageId)
      return
    }

    if (event.type === 'message.part.delta' && messageId) {
      const part = this.partById.get(event.properties.partID)
      if (!part || this.roleForPart(part) !== 'assistant' || (part.type !== 'text' && part.type !== 'reasoning')) return
      const delta = event.properties.delta
      if (!delta) return
      const nextText = `${this.emittedTextByPartId.get(part.id) ?? part.text}${delta}`
      this.emittedTextByPartId.set(part.id, nextText)
      this.partById.set(part.id, { ...part, text: nextText })
      this.emit({
        type: 'content_delta',
        messageId,
        delta: part.type === 'reasoning'
          ? { type: 'thinking', thinking: delta, startedAt: part.time.start, endedAt: part.time.end }
          : { type: 'text', text: delta },
      })
      return
    }

    if (event.type === 'permission.asked') {
      const request = mapOpenCodePermissionRequest({
        id: event.properties.id,
        permission: event.properties.permission,
        patterns: event.properties.patterns,
        metadata: event.properties.metadata,
        always: event.properties.always,
        toolUseId: event.properties.tool?.callID,
      })
      const item = { type: 'permission_request', request } as AgentEvent
      if (this.pendingPermissions.has(request.requestId)) return
      this.pendingPermissions.set(request.requestId, { request, event: item })
      this.emit(item)
      return
    }

    if (event.type === 'permission.v2.asked') {
      const request = mapOpenCodePermissionRequest({
        id: event.properties.id,
        permission: event.properties.action,
        patterns: event.properties.resources,
        metadata: event.properties.metadata,
        always: event.properties.save,
        toolUseId: event.properties.source?.callID,
      })
      const item = { type: 'permission_request', request } as AgentEvent
      if (this.pendingPermissions.has(request.requestId)) return
      this.pendingPermissions.set(request.requestId, { request, event: item })
      this.emit(item)
      return
    }

    if (event.type === 'permission.replied' || event.type === 'permission.v2.replied') {
      this.pendingPermissions.delete(event.properties.requestID)
      this.emit({
        type: 'interaction_resolved',
        interactionType: 'permission',
        requestId: event.properties.requestID,
        approved: event.properties.reply !== 'reject',
      })
      return
    }

    if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
      const request = mapOpenCodeQuestionRequest({ id: event.properties.id, questions: event.properties.questions })
      const item = { type: 'ask_user_question', request } as AgentEvent
      if (this.pendingQuestions.has(request.requestId)) return
      this.pendingQuestions.set(request.requestId, { request, event: item })
      this.emit(item)
      return
    }

    if (event.type === 'question.replied' || event.type === 'question.rejected'
      || event.type === 'question.v2.replied' || event.type === 'question.v2.rejected') {
      this.pendingQuestions.delete(event.properties.requestID)
      this.emit({ type: 'interaction_resolved', interactionType: 'question', requestId: event.properties.requestID })
      return
    }

    if (event.type === 'session.status') {
      const status = event.properties.status
      if (status.type === 'busy') this.emit({ type: 'status_change', status: 'streaming' })
      if (status.type === 'retry') {
        this.emit({ type: 'status_change', status: 'streaming' })
        this.emit({ type: 'api_retry', attempt: status.attempt, delayMs: Math.max(0, status.next - Date.now()), message: status.message })
      }
      if (status.type === 'idle' && messageId) this.complete(messageId)
      return
    }

    if (event.type === 'session.idle') {
      if (messageId) this.complete(messageId)
      return
    }

    if (event.type === 'session.compacted') {
      const compaction = this.activeCompaction
      if (compaction && messageId) {
        this.emit({ type: 'slash_command_output', messageId, content: '' })
      }
      this.emit({
        type: 'compact_boundary',
        trigger: compaction ? 'manual' : 'auto',
        preTokens: compaction?.preTokens ?? this.lastContextTokens,
        ...(compaction ? { durationMs: Date.now() - compaction.startedAt } : {}),
      })
      this.emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
      this.activeCompaction = null
      return
    }

    if (event.type === 'session.error') {
      if (messageId) this.fail(messageId, openCodeErrorMessage(event.properties.error))
    }
  }
}
