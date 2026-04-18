import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexRunRequest,
  CodexRunResult,
  CodexThreadItem,
  CodexUsageInfo,
  ContextUsageInfo,
  EffortLevel,
  McpServerInfo,
  PermissionMode,
  PermissionRequest,
  QuestionAnnotations,
  RewindFilesResult,
  SendMessageRequest,
} from '../../../shared/agent-types'
import log from '../../logger'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

export interface CodexRunStreamCallbacksDeps {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onPermissionRequest?: (request: PermissionRequest) => void
  onAskUserQuestion?: (request: AskUserQuestionRequest) => void
}

export interface CodexServiceDeps {
  run(
    sessionId: string,
    projectPath: string,
    request: CodexRunRequest,
    callbacks?: CodexRunStreamCallbacksDeps,
  ): Promise<CodexRunResult>
  interrupt(sessionId: string): boolean
  reset(sessionId: string): void
  respondToPermission(
    sessionId: string,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    decision?: 'cancel',
  ): void
  respondToQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string>,
  ): void
  dismissQuestion(sessionId: string, requestId: string): void
  steer(sessionId: string, input: string): Promise<void>
}

interface CodexBackendConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  permissionPreset?: CodexPermissionPreset
  reasoningEffort?: CodexReasoningEffort
}

function mapPermissionMode(mode: PermissionMode | undefined): CodexPermissionPreset {
  if (mode === 'bypassPermissions' || mode === 'acceptEdits') return 'full-access'
  return 'default'
}

function mapEffort(effort: EffortLevel | undefined): CodexReasoningEffort | undefined {
  if (!effort) return undefined
  if (effort === 'max') return 'xhigh'
  return effort
}

function readConfig(raw: unknown): CodexBackendConfig {
  if (raw && typeof raw === 'object') return raw as CodexBackendConfig
  return {}
}

let codexServiceFactory: (() => CodexServiceDeps) | null = null
export function setCodexServiceFactory(factory: (() => CodexServiceDeps) | null): void {
  codexServiceFactory = factory
}

export class CodexBackend implements SessionBackend {
  readonly kind: HarnessId = 'codex'

  private readonly service: CodexServiceDeps

  private started = false
  private disposed = false
  private providerSessionId: string | null = null
  private startOpts: BackendStartOptions | null = null
  private currentMessageId: string | null = null
  private activeRun: Promise<void> | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  constructor(service?: CodexServiceDeps) {
    const resolved = service ?? (codexServiceFactory ? codexServiceFactory() : null)
    if (!resolved) {
      throw new Error('CodexBackend: no CodexServiceDeps provided and factory not registered')
    }
    this.service = resolved
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.started) throw new Error('CodexBackend already started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
    this.startOpts = opts
    if (opts.providerSessionId) {
      this.providerSessionId = opts.providerSessionId
    }
    this.started = true
  }

  prewarm(_opts: BackendStartOptions): void {
    // Codex has no prewarm equivalent (no persistent subprocess to warm).
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    if (!this.started) { await this.start(opts); return }
    this.startOpts = opts
  }

  async send(request: SendMessageRequest): Promise<void> {
    this.assertStarted()
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend missing startOpts')

    const config = readConfig(startOpts.config)
    const assistantMessageId = request.assistantMessageId
      ?? `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.currentMessageId = assistantMessageId

    const codexRequest: CodexRunRequest = {
      prompt: request.codex?.prompt ?? request.content,
      images: request.images,
      model: request.model ?? config.model,
      reasoningEffort: request.codex?.reasoningEffort ?? mapEffort(request.effort) ?? config.reasoningEffort,
      permissionPreset: request.codex?.permissionPreset ?? config.permissionPreset ?? mapPermissionMode(startOpts.permissionMode),
      collaborationMode: request.codex?.collaborationMode,
      threadId: request.codex?.threadId ?? this.providerSessionId ?? undefined,
      messageId: assistantMessageId,
      cwd: request.codex?.cwd ?? startOpts.cwd,
    }

    const sessionKey = startOpts.sessionId
    const projectPath = startOpts.projectPath

    this.emit({
      type: 'message_start',
      message: {
        id: assistantMessageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'codex',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })
    const callbacks = this.buildCallbacks(assistantMessageId)
    const runStart = Date.now()

    const task = (async () => {
      try {
        const result = await this.service.run(sessionKey, projectPath, codexRequest, callbacks)
        const finalText = result.finalResponse?.trim() || 'Codex completed without returning text.'
        this.emit({
          type: 'message_complete',
          messageId: assistantMessageId,
          metadata: {
            codex: {
              finalResponse: finalText,
              durationMs: Date.now() - runStart,
              items: result.items,
              threadId: result.threadId,
              usage: result.usage,
            },
          } as Record<string, unknown>,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isInterrupt = /interrupt|abort/i.test(message)
        if (isInterrupt) {
          this.emit({ type: 'message_interrupted', messageId: assistantMessageId })
        } else {
          this.emit({ type: 'message_error', messageId: assistantMessageId, error: message })
        }
        throw error
      } finally {
        this.emit({ type: 'status_change', status: 'idle' })
        if (this.currentMessageId === assistantMessageId) this.currentMessageId = null
      }
    })()

    this.activeRun = task.catch(() => undefined).then(() => { this.activeRun = null })
    await task
  }

  async interrupt(): Promise<void> {
    if (!this.started) return
    const startOpts = this.startOpts
    if (!startOpts) return
    try {
      this.service.interrupt(startOpts.sessionId)
    } catch (err) {
      log.warn('[CodexBackend] interrupt threw: %s', err instanceof Error ? err.message : String(err))
    }
  }

  async close(): Promise<void> {
    if (this.disposed) return
    const startOpts = this.startOpts
    try { if (startOpts) this.service.reset(startOpts.sessionId) } catch { /* ignore */ }
    if (this.activeRun) { try { await this.activeRun } catch { /* ignore */ } }
    this.disposed = true
    this.started = false
    this.startOpts = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
  }

  async setModel(_model: string): Promise<void> {
    this.assertStarted()
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    this.assertStarted()
  }

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    _selectedSuggestions?: number[],
  ): void {
    const startOpts = this.startOpts
    if (!startOpts) return
    this.service.respondToPermission(startOpts.sessionId, requestId, allow, alwaysAllow, reason)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, _annotations?: QuestionAnnotations): void {
    const startOpts = this.startOpts
    if (!startOpts) return
    this.service.respondToQuestion(startOpts.sessionId, requestId, answers)
  }

  dismissQuestion(requestId: string): void {
    const startOpts = this.startOpts
    if (!startOpts) return
    this.service.dismissQuestion(startOpts.sessionId, requestId)
  }

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {
    log.debug('[CodexBackend] respondToPlanApproval not applicable to Codex')
  }

  async steer(input: string): Promise<void> {
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend not started')
    await this.service.steer(startOpts.sessionId, input)
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    return null
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'rewindFiles not supported by Codex' }
  }

  async reconnectMcp(_serverName: string): Promise<void> {
    throw new Error('reconnectMcp not supported by Codex')
  }

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {
    throw new Error('toggleMcpServer not supported by Codex')
  }

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(_clientMessageId: string): boolean {
    return false
  }

  getPendingInteractions(): AgentEvent[] {
    return []
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => { this.eventListeners.delete(handler) }
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => { this.providerSessionIdListeners.delete(handler) }
  }

  getCurrentProviderSessionId(): string | null {
    return this.providerSessionId
  }

  getStartOpts(): BackendStartOptions | null {
    return this.startOpts
  }

  emitForTest(event: AgentEvent): void {
    this.emit(event)
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try { cb(event) } catch (err) { log.warn('[CodexBackend] event listener error:', err) }
    }
  }

  private fireProviderSessionId(threadId: string): void {
    if (this.providerSessionId === threadId) return
    this.providerSessionId = threadId
    for (const cb of this.providerSessionIdListeners) {
      try { cb(threadId) } catch (err) { log.warn('[CodexBackend] providerSessionId listener error:', err) }
    }
  }

  private buildCallbacks(messageId: string): CodexRunStreamCallbacksDeps {
    return {
      onThreadStarted: (threadId: string) => {
        this.fireProviderSessionId(threadId)
        this.emit({ type: 'codex_thread_started', messageId, threadId })
      },
      onItemDelta: (phase, item) => {
        this.emit({ type: 'codex_item_delta', messageId, phase, item })
      },
      onUsageDelta: (usage) => {
        this.emit({
          type: 'message_usage',
          messageId,
          inputTokens: usage.lastInputTokens,
          outputTokens: usage.lastOutputTokens,
          codexUsage: usage,
        })
      },
      onPermissionRequest: (request) => {
        this.emit({ type: 'permission_request', request })
      },
      onAskUserQuestion: (request) => {
        this.emit({ type: 'ask_user_question', request })
      },
    }
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('CodexBackend not started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
  }
}
