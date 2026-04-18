import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { MessageBridge } from '../../agent/message-bridge'
import { buildClaudeOptions, createSessionQuery, buildUserMessage, type SessionQueryOptions } from '../../agent/claude-query'
import { getSharedWarmupManager } from '../../agent/warmup-manager'
import {
  createCanUseTool,
  rejectAllPending,
  respondToPermission as respondToPermissionInternal,
  respondToQuestion as respondToQuestionInternal,
  dismissQuestion as dismissQuestionInternal,
  respondToPlanApproval as respondToPlanApprovalInternal,
  type PendingPermission,
  type PendingQuestion,
  type PendingPlanApproval,
} from '../../agent/claude-permissions'
import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  QuestionAnnotations,
  RewindFilesResult,
  SendMessageRequest,
} from '../../../shared/agent-types'
import log from '../../logger'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

interface ClaudeConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
}

export class ClaudeBackend implements SessionBackend {
  readonly kind: HarnessId = 'claude'

  private bridge: MessageBridge | null = null
  private query: Query | null = null
  private iterationDone: Promise<void> | null = null

  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private turnResolves = new Map<string, () => void>()
  private providerSessionId: string | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()

  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()

  private warmupManager = getSharedWarmupManager()

  private buildQueryOptions(opts: BackendStartOptions): SessionQueryOptions {
    const config = (opts.config ?? {}) as ClaudeConfig
    const env: Record<string, string | undefined> = { ...(config.extraEnv ?? {}) }
    if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
    if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
    return {
      cwd: opts.cwd,
      model: opts.model ?? config.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      sandboxInfo: opts.sandboxInfo,
      resume: opts.providerSessionId,
      abortController: opts.abortController,
      additionalDirectories: opts.additionalDirectories,
      env: Object.keys(env).length > 0 ? env : undefined,
    }
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.bridge) throw new Error('ClaudeBackend already started')
    this.bridge = new MessageBridge()
    this.providerSessionId = opts.providerSessionId ?? null

    const { canUseTool, trackPlanFile } = createCanUseTool(
      this.pendingPermissions,
      this.pendingQuestions,
      this.pendingPlanApprovals,
      (e) => this.emit(e),
    )

    const queryOptions: SessionQueryOptions = {
      ...this.buildQueryOptions(opts),
      canUseTool,
      trackPlanFile,
      warmupManager: this.warmupManager,
    }

    const handle = createSessionQuery(
      this.bridge,
      queryOptions,
      (e) => this.emit(e),
      () => this.currentMessageId,
      () => this.currentStartTime,
      () => this.interrupted,
      (id) => {
        this.providerSessionId = id
        for (const cb of this.providerSessionIdListeners) {
          try { cb(id) } catch (err) { log.warn('[ClaudeBackend] providerSessionId listener error:', err) }
        }
      },
      (messageId) => {
        const oldId = this.currentMessageId
        const pending = oldId ? this.turnResolves.get(oldId) : undefined
        if (pending && oldId && oldId !== messageId) {
          this.turnResolves.delete(oldId)
          this.turnResolves.set(messageId, pending)
        }
        this.currentMessageId = messageId
        this.currentStartTime = Date.now()
        this.interrupted = false
      },
      () => { /* step boundary no-op */ },
    )

    this.query = handle.query
    this.iterationDone = handle.iterationDone
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.bridge || !this.query) throw new Error('ClaudeBackend not started')

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.currentMessageId = messageId
    this.currentStartTime = Date.now()
    this.interrupted = false

    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })

    const turnDone = new Promise<void>((resolve) => {
      this.turnResolves.set(messageId, resolve)
    })

    if (request.model) {
      try { await this.query.setModel(request.model) } catch (err) {
        log.debug('[ClaudeBackend] setModel skipped:', err)
      }
    }

    const userMsg = buildUserMessage(request, this.providerSessionId ?? '')
    this.bridge.push(userMsg)

    await turnDone
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    if (this.query) {
      try { await this.query.interrupt() } catch (err) {
        log.debug('[ClaudeBackend] interrupt error:', err)
      }
    }
  }

  async close(): Promise<void> {
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    if (this.query) {
      try { this.query.close() } catch { /* ignore */ }
    }
    if (this.bridge) this.bridge.close()
    if (this.iterationDone) await this.iterationDone.catch(() => {})
    this.bridge = null
    this.query = null
    this.iterationDone = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
  }

  prewarm(opts: BackendStartOptions): void {
    try {
      this.warmupManager.prewarm(buildClaudeOptions(this.buildQueryOptions(opts)))
    } catch (err) {
      log.debug('[ClaudeBackend] prewarm failed:', err)
    }
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    if (!this.bridge) {
      await this.start(opts)
      return
    }
    const resumeId = this.providerSessionId ?? undefined
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals)
    if (this.query) {
      try { this.query.close() } catch { /* ignore */ }
    }
    this.bridge.close()
    if (this.iterationDone) await this.iterationDone.catch(() => {})
    this.bridge = null
    this.query = null
    this.iterationDone = null
    await this.start({ ...opts, providerSessionId: resumeId })
  }

  async setModel(model: string): Promise<void> {
    if (!this.query) return
    await this.query.setModel(model)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.query) return
    await this.query.setPermissionMode(mode)
  }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[]): void {
    respondToPermissionInternal(this.pendingPermissions, requestId, allow, alwaysAllow, reason, selectedSuggestions)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations): void {
    respondToQuestionInternal(this.pendingQuestions, requestId, answers, annotations)
  }

  dismissQuestion(requestId: string): void {
    dismissQuestionInternal(this.pendingQuestions, requestId)
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    respondToPlanApprovalInternal(this.pendingPlanApprovals, requestId, approved, feedback)
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    if (!this.query) return null
    try {
      const usage = await this.query.getContextUsage()
      return {
        categories: usage.categories.map((c) => ({ name: c.name, tokens: c.tokens, color: c.color })),
        totalTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        model: usage.model,
      }
    } catch {
      return null
    }
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    if (!this.query) return []
    try {
      const statuses = await this.query.mcpServerStatus()
      return statuses.map((s) => ({
        name: s.name,
        status: s.status,
        error: s.error,
        scope: s.scope,
        toolCount: s.tools?.length,
        tools: s.tools?.map((t: { name: string; description?: string }) => ({
          name: t.name,
          description: t.description,
        })),
      }))
    } catch {
      return []
    }
  }

  async rewindFiles(userMessageId: string, opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    if (!this.query) return { canRewind: false, error: 'No active session' }
    try {
      const result = await this.query.rewindFiles(userMessageId, opts)
      return {
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
      }
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async reconnectMcp(serverName: string): Promise<void> {
    if (!this.query) throw new Error('No active session')
    await this.query.reconnectMcpServer(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    if (!this.query) throw new Error('No active session')
    await this.query.toggleMcpServer(serverName, enabled)
  }

  async reloadPlugins(): Promise<boolean> {
    if (!this.query) return false
    try {
      await this.query.reloadPlugins()
      return true
    } catch {
      return false
    }
  }

  dequeueMessage(clientMessageId: string): boolean {
    return this.bridge?.dequeue(clientMessageId) ?? false
  }

  getPendingInteractions(): AgentEvent[] {
    const events: AgentEvent[] = []
    for (const p of this.pendingPermissions.values()) events.push(p.event)
    for (const q of this.pendingQuestions.values()) events.push(q.event)
    for (const a of this.pendingPlanApprovals.values()) events.push(a.event)
    return events
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

  private emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try { cb(event) } catch (err) { log.warn('[ClaudeBackend] event listener error:', err) }
    }
    if (
      event.type === 'message_complete' ||
      event.type === 'message_interrupted' ||
      event.type === 'message_error'
    ) {
      const mid = (event as { messageId?: string }).messageId ?? this.currentMessageId
      const resolve = this.turnResolves.get(mid)
      if (resolve) {
        resolve()
        this.turnResolves.delete(mid)
      }
    }
  }
}
