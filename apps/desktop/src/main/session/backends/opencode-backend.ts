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
import { dispatchOpenCodeRequest } from '../../opencode/opencode-command'
import {
  commonPrefixLength,
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
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

type OpenCodeRuntimeFactory = (opts: OpenCodeRuntimeOptions) => Promise<OpenCodeRuntime>

let runtimeFactory: OpenCodeRuntimeFactory = createOpenCodeRuntime

export function setOpenCodeRuntimeFactory(factory: OpenCodeRuntimeFactory | null): void {
  runtimeFactory = factory ?? createOpenCodeRuntime
}

export class OpenCodeBackend implements SessionBackend {
  readonly kind: HarnessId = 'opencode'
  private runtime: OpenCodeRuntime | null = null
  private runtimePromise: Promise<OpenCodeRuntime> | null = null
  private runtimeEpoch = 0
  private opts: BackendStartOptions | null = null
  private config: OpenCodeRuntimeConfig = {}
  private permissionMode: PermissionMode = 'default'
  private started = false
  private disposed = false
  private interrupted = false
  private currentMessageId: string | null = null
  private activeTurn: { messageId: string; resolve: () => void } | null = null
  private terminalMessageId: string | null = null
  private messageRoleById = new Map<string, 'user' | 'assistant'>()
  private partById = new Map<string, Part>()
  private emittedTextByPartId = new Map<string, string>()
  private completedToolIds = new Set<string>()
  private latestMetadata: MessageMetadata | undefined
  private pendingPermissions = new Map<string, { request: PermissionRequest; event: AgentEvent }>()
  private pendingQuestions = new Map<string, { request: AskUserQuestionRequest; event: AgentEvent }>()
  private listeners = new Set<(event: AgentEvent) => void>()
  private providerSessionListeners = new Set<(id: string) => void>()
  private permissionModeListeners = new Set<(mode: PermissionMode) => void>()

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
    const opts = this.opts
    const promise = runtimeFactory({
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      providerSessionId: opts.providerSessionId,
      permissionMode: this.permissionMode,
      config: this.config,
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
      return runtime
    }).finally(() => {
      if (this.runtimePromise === promise) this.runtimePromise = null
    })
    this.runtimePromise = promise
    return promise
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('OpenCodeBackend not started')
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
      await dispatchOpenCodeRequest(runtime, request)
      await turnComplete
    } catch (error) {
      if (this.interrupted) this.complete(messageId, true)
      else this.fail(messageId, error instanceof Error ? error.message : String(error))
    } finally {
      const activeTurn = this.activeTurn as { messageId: string; resolve: () => void } | null
      if (activeTurn?.messageId === messageId) this.activeTurn = null
      this.currentMessageId = null
      this.resetTurnState()
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    for (const requestId of [...this.pendingPermissions.keys()]) this.respondToPermission(requestId, false)
    for (const requestId of [...this.pendingQuestions.keys()]) this.dismissQuestion(requestId)
    await this.runtime?.cancel().catch((error) => log.debug('[OpenCodeBackend] interrupt failed:', error))
    if (this.currentMessageId) this.complete(this.currentMessageId, true)
  }

  private async closeRuntime(): Promise<void> {
    this.runtimeEpoch += 1
    const pending = this.runtimePromise
    this.runtimePromise = null
    const runtime = this.runtime ?? await pending?.catch(() => null) ?? null
    this.runtime = null
    if (runtime) await runtime.close().catch((error) => log.debug('[OpenCodeBackend] runtime close failed:', error))
    this.pendingPermissions.clear()
    this.pendingQuestions.clear()
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
  async getContextUsage(): Promise<ContextUsageInfo | null> { return null }
  async getMcpServerStatus(): Promise<McpServerInfo[]> { return (await this.ensureRuntime()).getMcpServerStatus() }
  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'OpenCode harness does not support rewind yet' }
  }
  async reconnectMcp(serverName: string): Promise<void> { await (await this.ensureRuntime()).reconnectMcp(serverName) }
  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> { await (await this.ensureRuntime()).toggleMcpServer(serverName, enabled) }
  async reloadMcpServers(): Promise<void> {}
  async reloadPlugins(): Promise<boolean> { return false }
  dequeueMessage(_clientMessageId: string): boolean { return false }
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
          costUsd: info.cost,
        })
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

    if (event.type === 'session.error') {
      if (messageId) this.fail(messageId, openCodeErrorMessage(event.properties.error))
    }
  }
}
