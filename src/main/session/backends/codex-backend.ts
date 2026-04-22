import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexCompactRequest,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexReviewRequest,
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
import { trace } from '../../agent/event-trace'
import type { CodexRunStreamCallbacks } from '../../codex/codex-experiment-service'
import type { CodexSession } from '../../codex/codex-session'
import {
  codexSessionNeedsRebuild,
  createCodexSession,
} from '../../codex/codex-session'
import type { CodexProjectAuth } from '../../codex/app-server-connection'
import type { BackendCommand, BackendStartOptions, HarnessId, SessionBackend } from '../types'

export interface CodexRunStreamCallbacksDeps {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onPermissionRequest?: (request: PermissionRequest) => void
  onAskUserQuestion?: (request: AskUserQuestionRequest) => void
}

export interface CodexServiceDeps {
  getProjectAuth(projectPath: string): CodexProjectAuth
  onAuthChanged(projectPath: string, cb: () => void): () => void
  run(
    session: CodexSession,
    projectPath: string,
    request: CodexRunRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult>
  review(
    session: CodexSession,
    projectPath: string,
    request: CodexReviewRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult>
  compact(
    session: CodexSession,
    projectPath: string,
    request: CodexCompactRequest,
    callbacks?: CodexRunStreamCallbacks,
  ): Promise<CodexRunResult>
  interrupt(session: CodexSession): boolean
  reset(session: CodexSession): void
  respondToPermission(
    session: CodexSession,
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    decision?: 'cancel',
  ): boolean
  respondToQuestion(
    session: CodexSession,
    requestId: string,
    answers: Record<string, string>,
  ): boolean
  dismissQuestion(session: CodexSession, requestId: string): boolean
  steer(session: CodexSession, input: string): Promise<void>
  closeSessionConnection(session: CodexSession): Promise<void>
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

function getCodexTraceTextLength(item: CodexThreadItem): number | undefined {
  switch (item.type) {
    case 'agent_message':
    case 'reasoning':
    case 'plan':
    case 'review':
      return item.text.length
    default:
      return undefined
  }
}

function summarizeCodexItemsForTrace(items: CodexThreadItem[]): Array<{ id: string; type: CodexThreadItem['type']; textLen?: number }> {
  return items.slice(-3).map((item) => {
    const textLen = getCodexTraceTextLength(item)
    return textLen === undefined
      ? { id: item.id, type: item.type }
      : { id: item.id, type: item.type, textLen }
  })
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
  private swapRunAssistantId: ((nextId: string) => void) | null = null

  private session: CodexSession | null = null
  private authChangedUnsub: (() => void) | null = null

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
    this.session = createCodexSession(
      opts.projectPath,
      undefined,
      opts.providerSessionId ?? undefined,
      undefined,
      undefined,
    )
    this.authChangedUnsub = this.service.onAuthChanged(opts.projectPath, () => {
      this.handleAuthChanged()
    })
    this.started = true
  }

  prewarm(_opts: BackendStartOptions): void {
    // Codex has no prewarm equivalent yet — future work: spawn the app-server
    // eagerly and run initialize so the first turn skips that cost.
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    if (!this.started) { await this.start(opts); return }
    this.startOpts = opts
  }

  private handleAuthChanged(): void {
    const session = this.session
    if (!session) return
    if (session.runningController) {
      try { session.runningController.abort() } catch { /* ignore */ }
    }
    void this.service.closeSessionConnection(session)
  }

  private ensureSessionForRequest(
    requestedModel?: string,
    requestedThreadId?: string,
    requestedReasoningEffort?: CodexReasoningEffort,
    requestedPermissionPreset?: CodexPermissionPreset,
  ): CodexSession {
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend missing startOpts')
    const existing = this.session
    if (!existing) {
      const created = createCodexSession(
        startOpts.projectPath,
        requestedModel,
        requestedThreadId,
        requestedReasoningEffort,
        requestedPermissionPreset,
      )
      this.session = created
      return created
    }

    if (codexSessionNeedsRebuild(existing, requestedModel, requestedThreadId, requestedReasoningEffort, requestedPermissionPreset)) {
      this.service.reset(existing)
      const recreated = createCodexSession(
        startOpts.projectPath,
        requestedModel ?? existing.model,
        requestedThreadId ?? existing.threadId ?? undefined,
        requestedReasoningEffort ?? existing.modelReasoningEffort,
        requestedPermissionPreset ?? existing.permissionPreset,
      )
      this.session = recreated
      return recreated
    }

    return existing
  }

  async send(request: SendMessageRequest): Promise<void> {
    this.assertStarted()
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend missing startOpts')

    const config = readConfig(startOpts.config)
    const assistantMessageId = request.assistantMessageId
      ?? `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const mode = request.codex?.mode ?? 'run'
    const projectPath = startOpts.projectPath
    const resolvedPermissionPreset = request.codex?.permissionPreset
      ?? config.permissionPreset
      ?? mapPermissionMode(startOpts.permissionMode)
    const resolvedReasoningEffort = request.codex?.reasoningEffort
      ?? mapEffort(request.effort)
      ?? config.reasoningEffort
    const resolvedModel = request.model ?? config.model
    const resolvedThreadId = request.codex?.threadId ?? this.providerSessionId ?? undefined
    const resolvedCwd = request.codex?.cwd ?? startOpts.cwd

    const session = this.ensureSessionForRequest(
      resolvedModel,
      resolvedThreadId,
      resolvedReasoningEffort,
      resolvedPermissionPreset,
    )

    this.currentMessageId = assistantMessageId
    let runningAssistantId = assistantMessageId
    this.swapRunAssistantId = (nextId: string) => {
      runningAssistantId = nextId
      this.currentMessageId = nextId
    }

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
    const callbacks = this.buildCallbacks()
    const runStart = Date.now()

    const task = (async () => {
      try {
        let result: CodexRunResult
        if (mode === 'review') {
          if (!request.codex?.reviewTarget) throw new Error('CodexBackend review mode requires codex.reviewTarget')
          const reviewRequest: CodexReviewRequest = {
            target: request.codex.reviewTarget,
            model: resolvedModel,
            reasoningEffort: resolvedReasoningEffort,
            permissionPreset: resolvedPermissionPreset,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
          }
          result = await this.service.review(session, projectPath, reviewRequest, callbacks)
        } else if (mode === 'compact') {
          const compactRequest: CodexCompactRequest = {
            model: resolvedModel,
            permissionPreset: resolvedPermissionPreset,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
          }
          result = await this.service.compact(session, projectPath, compactRequest, callbacks)
        } else {
          const codexRequest: CodexRunRequest = {
            prompt: request.codex?.prompt ?? request.content,
            images: request.images,
            model: resolvedModel,
            reasoningEffort: resolvedReasoningEffort,
            permissionPreset: resolvedPermissionPreset,
            collaborationMode: request.codex?.collaborationMode,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
          }
          result = await this.service.run(session, projectPath, codexRequest, callbacks)
        }
        const finalText = result.finalResponse?.trim()
          || (mode === 'compact' ? 'Conversation compacted.' : 'Codex completed without returning text.')
        trace('codex.turn', 'message_complete_prepare', {
          projectPath,
          assistantMessageId,
          currentMessageId: this.currentMessageId,
          runningAssistantId,
          threadId: result.threadId,
          finalResponseLength: finalText.length,
          itemsLength: result.items.length,
          itemsTail: summarizeCodexItemsForTrace(result.items),
        }, runningAssistantId)
        this.emit({
          type: 'message_complete',
          messageId: runningAssistantId,
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
          this.emit({ type: 'message_interrupted', messageId: runningAssistantId })
        } else {
          this.emit({ type: 'message_error', messageId: runningAssistantId, error: message })
        }
        throw error
      } finally {
        this.emit({ type: 'status_change', status: 'idle' })
        if (this.currentMessageId === runningAssistantId) this.currentMessageId = null
        this.swapRunAssistantId = null
      }
    })()

    this.activeRun = task.catch(() => undefined).then(() => { this.activeRun = null })
    await task
  }

  async interrupt(): Promise<void> {
    if (!this.started) return
    const session = this.session
    if (!session) return
    try {
      this.service.interrupt(session)
    } catch (err) {
      log.warn('[CodexBackend] interrupt threw: %s', err instanceof Error ? err.message : String(err))
    }
  }

  async close(): Promise<void> {
    if (this.disposed) return
    const session = this.session
    try { if (session) this.service.reset(session) } catch { /* ignore */ }
    if (this.activeRun) { try { await this.activeRun } catch { /* ignore */ } }
    if (this.authChangedUnsub) {
      try { this.authChangedUnsub() } catch { /* ignore */ }
      this.authChangedUnsub = null
    }
    this.session = null
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

  async setSandbox(): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    _selectedSuggestions?: number[],
  ): boolean {
    const session = this.session
    if (!session) return false
    return this.service.respondToPermission(session, requestId, allow, alwaysAllow, reason)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, _annotations?: QuestionAnnotations): void {
    const session = this.session
    if (!session) return
    this.service.respondToQuestion(session, requestId, answers)
  }

  dismissQuestion(requestId: string): void {
    const session = this.session
    if (!session) return
    this.service.dismissQuestion(session, requestId)
  }

  respondToPlanApproval(_requestId: string, _approved: boolean, _feedback?: string): void {
    log.debug('[CodexBackend] respondToPlanApproval not applicable to Codex')
  }

  async handleCommand(cmd: BackendCommand): Promise<void> {
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend not started')
    const session = this.session
    if (!session) throw new Error('CodexBackend session not initialized')
    switch (cmd.kind) {
      case 'codex.steer': {
        trace('codex.steer', 'dispatch', {
          sessionId: startOpts.sessionId,
          currentMessageId: this.currentMessageId,
          newAssistantMessageId: cmd.newAssistantMessageId ?? null,
          newUserMessageId: cmd.newUserMessageId ?? null,
          inputLength: cmd.input.length,
        }, cmd.newAssistantMessageId ?? this.currentMessageId ?? '')
        if (cmd.newAssistantMessageId) {
          this.emit({
            type: 'message_start',
            message: {
              id: cmd.newAssistantMessageId,
              role: 'assistant',
              status: 'streaming',
              content: [],
              createdAt: new Date().toISOString(),
              providerId: 'codex',
            },
          })
          this.swapRunAssistantId?.(cmd.newAssistantMessageId)
        }
        await this.service.steer(session, cmd.input)
        return
      }
      case 'codex.plan_approval':
      case 'codex.collaboration_mode_change':
        return
    }
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

  onPermissionModeApplied(_handler: (mode: PermissionMode) => void): () => void {
    return () => {}
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

  private buildCallbacks(): CodexRunStreamCallbacksDeps {
    return {
      onThreadStarted: (threadId: string) => {
        this.fireProviderSessionId(threadId)
        const messageId = this.currentMessageId
        if (!messageId) return
        this.emit({ type: 'codex_thread_started', messageId, threadId })
      },
      onItemDelta: (phase, item) => {
        const messageId = this.currentMessageId
        if (!messageId) return
        this.emit({ type: 'codex_item_delta', messageId, phase, item })
      },
      onUsageDelta: (usage) => {
        const messageId = this.currentMessageId
        if (!messageId) return
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
