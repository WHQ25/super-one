import type { CanUseTool, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { MessageBridge } from '../../agent/message-bridge'
import { buildClaudeOptions, createSessionQuery, buildUserMessage, type SessionQueryOptions, type BackgroundTaskInfo } from '../../agent/claude-query'
import { getGlobalWarmupManager, WarmupManager } from '../../agent/warmup-manager'
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
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import log from '../../logger'
import { trace } from '../../agent/event-trace'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'
import { readAppSettings } from '../../app-settings-service'
import { ensureProxy, type ProxyUpstream } from '../../providers/llm-proxy-manager'
import { getSandboxCapability } from '../../sandbox-platform'
import { listSkills } from '../../skills-service'

interface ClaudeConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  proxy?: ProxyUpstream
}

export class ClaudeBackend implements SessionBackend {
  readonly kind: HarnessId = 'claude'

  private bridge: MessageBridge | null = null
  private query: Query | null = null
  private iterationDone: Promise<void> | null = null
  private spawnAbortController: AbortController | null = null

  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private turnResolves = new Map<string, () => void>()
  private providerSessionId: string | null = null
  private pendingQueued: Array<{ msg: SDKUserMessage; clientMessageId: string }> = []

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()
  private permissionModeAppliedListeners = new Set<(mode: PermissionMode) => void>()

  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()

  private canUseToolHandle: CanUseTool | null = null
  private trackPlanFileHandle: ((filePath: string) => void) | null = null

  private get warmupManager() { return getGlobalWarmupManager() }

  private _lastActiveAt: number | null = null
  private _lastStartOpts: BackendStartOptions | null = null
  private _spawnedAdditionalDirs: string[] = []
  private activeBackgroundTasks: Map<string, BackgroundTaskInfo> | null = null
  private _idleTimer: ReturnType<typeof setInterval> | null = null
  private _proxyBaseUrl: string | null = null
  private _activeRuntimeKey: string | null = null

  static IDLE_TIMEOUT_MS = 180_000
  static IDLE_CHECK_INTERVAL_MS = 30_000

  private ensurePermissionHandles(): { canUseTool: CanUseTool; trackPlanFile: (filePath: string) => void } {
    if (!this.canUseToolHandle || !this.trackPlanFileHandle) {
      const handles = createCanUseTool(
        this.pendingPermissions,
        this.pendingQuestions,
        this.pendingPlanApprovals,
        (e) => this.emit(e),
        (mode) => this.emitPermissionModeApplied(mode),
      )
      this.canUseToolHandle = handles.canUseTool
      this.trackPlanFileHandle = handles.trackPlanFile
    }
    return { canUseTool: this.canUseToolHandle, trackPlanFile: this.trackPlanFileHandle }
  }

  private emitPermissionModeApplied(mode: PermissionMode): void {
    for (const cb of this.permissionModeAppliedListeners) {
      try { cb(mode) } catch (err) { log.warn('[ClaudeBackend] permissionModeApplied listener error:', err) }
    }
  }

  private buildQueryOptions(opts: BackendStartOptions): SessionQueryOptions {
    const config = (opts.config ?? {}) as ClaudeConfig
    const custom: Record<string, string | undefined> = { ...(config.extraEnv ?? {}) }
    if (config.apiKey) custom.ANTHROPIC_API_KEY = config.apiKey
    if (this._proxyBaseUrl) {
      custom.ANTHROPIC_BASE_URL = this._proxyBaseUrl
    } else if (config.baseUrl) {
      custom.ANTHROPIC_BASE_URL = config.baseUrl
    }
    const { canUseTool, trackPlanFile } = this.ensurePermissionHandles()
    const claudePref = readAppSettings().agentPreference.claude
    const disabled = claudePref.disabledSkills
    let enabledSkills: string[] | undefined
    if (disabled.length > 0) {
      const all = listSkills(opts.cwd).map((s) => s.name)
      enabledSkills = all.filter((n) => !disabled.includes(n))
    }
    return {
      superoneSessionId: opts.sessionId,
      projectPath: opts.projectPath,
      cwd: opts.cwd,
      model: opts.model ?? config.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      sandboxInfo: opts.sandboxInfo,
      canUseTool,
      trackPlanFile,
      resume: opts.providerSessionId,
      abortController: opts.abortController,
      additionalDirectories: opts.additionalDirectories,
      env: Object.keys(custom).length > 0 ? { ...process.env, ...custom } : undefined,
      enabledSkills,
      askUserQuestionPreviewFormat: claudePref.askUserQuestionPreviewFormat,
    }
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.bridge) throw new Error('ClaudeBackend already started')
    this._lastStartOpts = opts
    this._spawnedAdditionalDirs = [...(opts.additionalDirectories ?? [])]
    const config = (opts.config ?? {}) as ClaudeConfig
    if (config.proxy) {
      const { url } = await ensureProxy(config.proxy)
      this._proxyBaseUrl = url
    }
    this.bridge = new MessageBridge()
    this.bridge.onConsumed = (tag) => {
      this.emit({ type: 'queued_message_consumed', clientMessageId: tag })
    }
    this.providerSessionId = opts.providerSessionId ?? null

    const queryOptions: SessionQueryOptions = {
      ...this.buildQueryOptions(opts),
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
      () => this.flushPendingQueued(),
    )

    this.query = handle.query
    this.iterationDone = handle.iterationDone
    this.spawnAbortController = handle.spawnAbortController
    this.activeBackgroundTasks = handle.activeBackgroundTasks ?? null
    this._activeRuntimeKey = WarmupManager.keyOf(buildClaudeOptions(queryOptions))
    this._lastActiveAt = Date.now()
    this.startIdleTimer()
  }

  private startIdleTimer(): void {
    this.stopIdleTimer()
    log.info('[ClaudeBackend.idle-diag] timer start sid=%s timeoutMs=%d intervalMs=%d', this._lastStartOpts?.sessionId, ClaudeBackend.IDLE_TIMEOUT_MS, ClaudeBackend.IDLE_CHECK_INTERVAL_MS)
    this._idleTimer = setInterval(() => {
      if (this.isRuntimeIdle(ClaudeBackend.IDLE_TIMEOUT_MS)) {
        log.info('[ClaudeBackend.idle-diag] eligible sid=%s elapsedMs=%d', this._lastStartOpts?.sessionId, this._lastActiveAt ? Date.now() - this._lastActiveAt : -1)
        void this.releaseRuntime('idle').catch((err) => {
          log.debug('[ClaudeBackend] idle release error:', err)
        })
      }
    }, ClaudeBackend.IDLE_CHECK_INTERVAL_MS)
  }

  private stopIdleTimer(): void {
    if (this._idleTimer) {
      clearInterval(this._idleTimer)
      this._idleTimer = null
    }
  }

  async send(request: SendMessageRequest): Promise<void> {
    await this.ensureRuntime()
    if (!this.bridge || !this.query) throw new Error('ClaudeBackend not started')
    this._lastActiveAt = Date.now()

    const isQueued = request.priority === 'next'
    if (isQueued) {
      const userMsg = buildUserMessage(request, this.providerSessionId ?? '')
      const tag = request.clientMessageId
      if (!tag) {
        log.warn('[ClaudeBackend] queued send missing clientMessageId, pushing untagged')
        this.bridge.push(userMsg)
        return
      }
      if (this.turnResolves.size > 0) {
        this.pendingQueued.push({ msg: userMsg, clientMessageId: tag })
      } else {
        this.bridge.push(userMsg, tag)
      }
      return
    }

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

  private flushPendingQueued(): void {
    if (!this.bridge || this.pendingQueued.length === 0) return
    for (const item of this.pendingQueued) {
      this.bridge.push(item.msg, item.clientMessageId)
    }
    this.pendingQueued = []
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    this._lastActiveAt = Date.now()
    this.pendingQueued = []
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, 'backend.interrupt')
    if (this.query) {
      try { await this.query.interrupt() } catch (err) {
        log.debug('[ClaudeBackend] interrupt error:', err)
      }
    }
  }

  async close(): Promise<void> {
    await this.releaseRuntime('close')
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
    this.permissionModeAppliedListeners.clear()
  }

  private async releaseRuntime(reason: 'idle' | 'rebuild' | 'close'): Promise<void> {
    if (!this.bridge && !this.query) return
    const liveTasks = this.activeBackgroundTasks
    this.activeBackgroundTasks = null
    if (reason !== 'close' && liveTasks && liveTasks.size > 0) {
      for (const [taskId, info] of liveTasks) {
        this.emit({
          type: 'task_notification',
          taskId,
          toolUseId: info.toolUseId,
          taskStatus: 'stopped',
          outputFile: '',
          summary: `Background task terminated: agent process was ${reason === 'rebuild' ? 'restarted' : 'released'}`,
        })
      }
      liveTasks.clear()
    }
    const sid = this._lastStartOpts?.sessionId
    const acAbortedBefore = this._lastStartOpts?.abortController?.signal.aborted ?? null
    log.info('[ClaudeBackend.idle-diag] releaseRuntime begin sid=%s reason=%s abortSignalBefore=%s', sid, reason, acAbortedBefore)
    const t0 = Date.now()
    const bridge = this.bridge
    const query = this.query
    const iterationDone = this.iterationDone
    const spawnAbortController = this.spawnAbortController
    this.bridge = null
    this.query = null
    this.iterationDone = null
    this.spawnAbortController = null
    this._activeRuntimeKey = null
    this._lastActiveAt = null
    this.stopIdleTimer()
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()
    this.pendingQueued = []
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, `backend.${reason}`)
    if (query) {
      const t1 = Date.now()
      try { query.close() } catch { /* ignore */ }
      log.info('[ClaudeBackend.idle-diag] query.close done sid=%s tookMs=%d', sid, Date.now() - t1)
    }
    if (bridge) {
      const t2 = Date.now()
      bridge.close()
      log.info('[ClaudeBackend.idle-diag] bridge.close done sid=%s tookMs=%d', sid, Date.now() - t2)
    }
    let iterationOutcome: 'resolved' | 'rejected' | 'timeout-5s' | 'skipped' = 'skipped'
    if (iterationDone) {
      const t3 = Date.now()
      iterationOutcome = await Promise.race([
        iterationDone.then(() => 'resolved' as const).catch(() => 'rejected' as const),
        new Promise<'timeout-5s'>((resolve) => setTimeout(() => resolve('timeout-5s'), 5000)),
      ])
      log.info('[ClaudeBackend.idle-diag] iterationDone sid=%s outcome=%s tookMs=%d', sid, iterationOutcome, Date.now() - t3)
    }
    if (spawnAbortController) {
      const wasAborted = spawnAbortController.signal.aborted
      try { spawnAbortController.abort() } catch { /* ignore */ }
      log.info('[ClaudeBackend.idle-diag] spawn SIGTERM sid=%s alreadyAborted=%s iterationOutcome=%s', sid, wasAborted, iterationOutcome)
    }
    log.info('[ClaudeBackend.idle-diag] releaseRuntime end sid=%s totalMs=%d', sid, Date.now() - t0)
    trace('backend.lifecycle', 'runtime_released', { reason })
  }

  private async ensureRuntime(): Promise<void> {
    if (this.bridge && this.query) return
    if (!this._lastStartOpts) throw new Error('ClaudeBackend not started')
    const resumeId = this.providerSessionId ?? undefined
    await this.start({ ...this._lastStartOpts, abortController: new AbortController(), providerSessionId: resumeId })
  }

  private async ensureQuery(): Promise<Query | null> {
    if (this.query) return this.query
    try {
      await this.ensureRuntime()
    } catch (err) {
      log.debug('[ClaudeBackend] ensureQuery revive failed:', err)
    }
    return this.query
  }

  prewarm(opts: BackendStartOptions): void {
    const config = (opts.config ?? {}) as ClaudeConfig
    if (config.proxy) return
    try {
      const options = buildClaudeOptions(this.buildQueryOptions(opts))
      if (this.query && this._activeRuntimeKey === WarmupManager.keyOf(options)) return
      this.warmupManager.prewarm(options)
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
    await this.releaseRuntime('rebuild')
    await this.start({ ...opts, providerSessionId: resumeId })
  }

  async setSessionMode(_modeId: string): Promise<void> {}

  async setModel(model: string): Promise<void> {
    if (this._lastStartOpts) this._lastStartOpts.model = model
    if (!this.query) return
    try {
      await this.query.setModel(model)
    } catch (err) {
      log.warn('[ClaudeBackend] setModel rejected by SDK, keeping optimistic model:', model, err)
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this._lastStartOpts) this._lastStartOpts.permissionMode = mode
    if (!this.query) {
      trace('permission.flow', 'backend_setMode_no_query', { mode })
      return
    }
    trace('permission.flow', 'backend_setMode_sdk_call', { mode })
    try {
      await this.query.setPermissionMode(mode)
      trace('permission.flow', 'backend_setMode_sdk_done', { mode })
    } catch (err) {
      trace('permission.flow', 'backend_setMode_sdk_error', { mode, err: (err as Error)?.message })
      throw err
    }
  }

  async setSandbox(sandboxInfo: SandboxInfo): Promise<void> {
    if (this._lastStartOpts) this._lastStartOpts.sandboxInfo = sandboxInfo
    if (!this.query) return
    const supported = getSandboxCapability().supportLevel !== 'unsupported'
    const sandbox = sandboxInfo.enabled && supported
      ? { enabled: true, autoAllowBashIfSandboxed: sandboxInfo.autoAllowBash, failIfUnavailable: false }
      : { enabled: false }
    await this.query.applyFlagSettings({ sandbox })
  }

  async setAdditionalDirectories(dirs: string[]): Promise<boolean> {
    if (this._lastStartOpts) this._lastStartOpts.additionalDirectories = [...dirs]
    if (!this.query) return true
    if (this._spawnedAdditionalDirs.some((d) => !dirs.includes(d))) return false
    await this.query.applyFlagSettings({ permissions: { additionalDirectories: dirs } })
    return true
  }

  async stopTask(taskId: string): Promise<void> {
    if (!this.query) return
    await this.query.stopTask(taskId)
  }

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], _decision?: 'cancel', _formAnswers?: Record<string, unknown>): boolean {
    return respondToPermissionInternal(this.pendingPermissions, requestId, allow, alwaysAllow, reason, selectedSuggestions)
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
    const query = await this.ensureQuery()
    if (!query) return null
    try {
      const usage = await query.getContextUsage()
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
    const query = await this.ensureQuery()
    if (!query) return []
    try {
      const statuses = await query.mcpServerStatus()
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
    const query = await this.ensureQuery()
    if (!query) return { canRewind: false, error: 'No active session' }
    try {
      const result = await query.rewindFiles(userMessageId, opts)
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

  async reloadMcpServers(): Promise<void> {
    // No-op: the in-process SDK MCP server reflects the current tool set on every
    // turn, so dynamically added/removed superone app tools are picked up without
    // an explicit refresh (unlike Codex, which snapshots tools once per thread).
  }

  async reconnectMcp(serverName: string): Promise<void> {
    const query = await this.ensureQuery()
    if (!query) throw new Error('No active session')
    await query.reconnectMcpServer(serverName)
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    const query = await this.ensureQuery()
    if (!query) throw new Error('No active session')
    await query.toggleMcpServer(serverName, enabled)
  }

  async reloadPlugins(): Promise<boolean> {
    const query = await this.ensureQuery()
    if (!query) return false
    try {
      await query.reloadPlugins()
      return true
    } catch {
      return false
    }
  }

  dequeueMessage(clientMessageId: string): boolean {
    const idx = this.pendingQueued.findIndex((p) => p.clientMessageId === clientMessageId)
    if (idx !== -1) {
      this.pendingQueued.splice(idx, 1)
      return true
    }
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

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => { this.permissionModeAppliedListeners.delete(handler) }
  }

  getCurrentProviderSessionId(): string | null {
    return this.providerSessionId
  }

  isRuntimeIdle(timeoutMs: number): boolean {
    if (!this.bridge || !this.query) return false
    if (this._lastActiveAt == null) return false
    if (Date.now() - this._lastActiveAt < timeoutMs) return false
    if (this.pendingPermissions.size > 0) return false
    if (this.pendingQuestions.size > 0) return false
    if (this.pendingPlanApprovals.size > 0) return false
    if (this.turnResolves.size > 0) return false
    if (this.pendingQueued.length > 0) return false
    if (this.hasActiveBackgroundTasks()) return false
    return true
  }

  hasActiveBackgroundTasks(): boolean {
    return (this.activeBackgroundTasks?.size ?? 0) > 0
  }

  private emit(event: AgentEvent): void {
    this._lastActiveAt = Date.now()
    if (event.type === 'permission_request') {
      log.info('[ClaudeBackend.emit] permission_request listeners=%d requestId=%s', this.eventListeners.size, event.request.requestId)
    }
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
