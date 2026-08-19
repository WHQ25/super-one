import type { CanUseTool, OnElicitation, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { MessageBridge } from '../../agent/message-bridge'
import { buildClaudeOptions, createSessionQuery, buildUserMessage, type SessionQueryOptions, type BackgroundTaskInfo } from '../../agent/claude-query'
import { getGlobalWarmupManager, WarmupManager } from '../../agent/warmup-manager'
import {
  createCanUseTool,
  createOnElicitation,
  rejectAllPending,
  respondToElicitation as respondToElicitationInternal,
  respondToPermission as respondToPermissionInternal,
  respondToQuestion as respondToQuestionInternal,
  dismissQuestion as dismissQuestionInternal,
  respondToPlanApproval as respondToPlanApprovalInternal,
  type PendingElicitation,
  type PendingPermission,
  type PendingQuestion,
  type PendingPlanApproval,
} from '../../agent/claude-permissions'
import { resolveVideoConfirm, rejectVideoConfirm } from '../../mcp/media-tools'
import { resolveConfigConfirm, rejectConfigConfirm } from '../../mcp/config-tools'
import { resolveComputerUseGrant, rejectComputerUseGrant } from '../../computer-use/grant-request'
import { inspectClaudeTranscript } from '@superone/claude'
import { buildSafeEnv } from '../../spawn-env'
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
import { DEADLINE_EXCEEDED, INTERRUPT_CANCEL_TIMEOUT_MS, withDeadline } from '../../promise-deadline'
import { trace } from '../../agent/event-trace'
import type { BackendStartOptions, HarnessId, SessionBackend, TaskNotificationInjectResult } from '../types'
import { readAppSettings } from '../../app-settings-service'
import { ensureProxy, type ProxyUpstream } from '../../providers/llm-proxy-manager'
import { getSandboxCapability } from '../../sandbox-platform'
import { listSkills } from '../../skills-service'
import { hasRunningDownloadTasks } from '../../browser/browser-download-tasks'

interface ClaudeConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  proxy?: ProxyUpstream
}

/**
 * SDK control requests carry no built-in timeout — `query.interrupt()` awaits a
 * `control_response` forever if the CLI process is wedged. Stop must always be
 * able to fall through to the rebuild escape hatch.
 */
const INTERRUPT_ACK_TIMEOUT_MS = INTERRUPT_CANCEL_TIMEOUT_MS
/**
 * After the CLI acks an interrupt it must close the turn with a `result`, which
 * is the only thing that produces a terminal event. A CLI stuck mid-request can
 * ack and then never emit one, which used to leave `interrupted` latched — the
 * SDK loop then swallowed every later message while the agent kept working.
 */
const INTERRUPT_SETTLE_TIMEOUT_MS = 10_000

export class ClaudeBackend implements SessionBackend {
  readonly kind: HarnessId = 'claude'

  private bridge: MessageBridge | null = null
  private query: Query | null = null
  private iterationDone: Promise<void> | null = null
  private spawnAbortController: AbortController | null = null

  private currentMessageId = ''
  private currentStartTime = 0
  private interrupted = false
  private interruptSettleTimer: ReturnType<typeof setTimeout> | null = null
  private turnResolves = new Map<string, () => void>()
  private providerSessionId: string | null = null
  /** Init id of a run that has not produced conversation content yet — see `stageProviderSessionId`. */
  private stagedProviderSessionId: string | null = null
  private pendingQueued: Array<{ msg: SDKUserMessage; clientMessageId: string }> = []

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()
  private permissionModeAppliedListeners = new Set<(mode: PermissionMode) => void>()

  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingQuestions = new Map<string, PendingQuestion>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()
  private pendingElicitations = new Map<string, PendingElicitation>()

  private canUseToolHandle: CanUseTool | null = null
  private onElicitationHandle: OnElicitation | null = null
  private trackPlanFileHandle: ((filePath: string) => void) | null = null

  private get warmupManager() { return getGlobalWarmupManager() }

  private _lastStartOpts: BackendStartOptions | null = null
  private _spawnedAdditionalDirs: string[] = []
  private activeBackgroundTasks: Map<string, BackgroundTaskInfo> | null = null
  private _proxyBaseUrl: string | null = null
  private _activeRuntimeKey: string | null = null

  hasActiveRuntime(): boolean {
    return Boolean(this.bridge && this.query)
  }

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

  private ensureOnElicitation(): OnElicitation {
    if (!this.onElicitationHandle) {
      this.onElicitationHandle = createOnElicitation(this.pendingElicitations, (e) => this.emit(e))
    }
    return this.onElicitationHandle
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
      onElicitation: this.ensureOnElicitation(),
      trackPlanFile,
      resume: opts.providerSessionId,
      abortController: opts.abortController,
      additionalDirectories: opts.additionalDirectories,
      env: Object.keys(custom).length > 0 ? buildSafeEnv(custom) : undefined,
      enabledSkills,
      askUserQuestionPreviewFormat: claudePref.askUserQuestionPreviewFormat,
      systemPromptAppend: opts.systemPromptAppend,
    }
  }

  /**
   * `init` arrives before the run has written a single conversation row, so its
   * session id is only a candidate. Adopting it unconditionally lets a run that
   * dies early (third-party key rejected, sidecar gone, spawn aborted) overwrite
   * a working resume pointer with an id whose transcript holds nothing but
   * startup rows — and the CLI resumes such a transcript *silently* with empty
   * context, so the next turn greets a full chat as a brand new session.
   *
   * A first id is adopted immediately (nothing to lose); a *replacement* waits
   * until the run proves it produced content.
   */
  private stageProviderSessionId(id: string): void {
    if (!id || id === this.providerSessionId) {
      this.stagedProviderSessionId = null
      return
    }
    if (this.providerSessionId === null) {
      this.commitProviderSessionId(id)
      return
    }
    this.stagedProviderSessionId = id
    log.info(
      '[ClaudeBackend] provider session id staged sid=%s current=%s init=%s (adopted once the run produces content)',
      this._lastStartOpts?.sessionId,
      this.providerSessionId,
      id,
    )
  }

  private commitProviderSessionId(id: string): void {
    this.stagedProviderSessionId = null
    if (!id || id === this.providerSessionId) return
    this.providerSessionId = id
    for (const cb of this.providerSessionIdListeners) {
      try { cb(id) } catch (err) { log.warn('[ClaudeBackend] providerSessionId listener error:', err) }
    }
  }

  /**
   * Diagnostic only. A resume target that is missing fails loudly in the CLI,
   * but one that exists without conversation rows resumes as an empty chat with
   * no error anywhere — this log is the only trace of that context loss.
   */
  private warnOnUnusableResumeTarget(opts: BackendStartOptions): void {
    const resumeId = opts.providerSessionId?.trim()
    if (!resumeId) return
    const state = inspectClaudeTranscript(resumeId, opts.cwd)
    if (state === 'ok' || state === 'unknown') return
    log.warn(
      '[ClaudeBackend] resume target %s sid=%s providerSessionId=%s cwd=%s — the agent will not see the stored history',
      state,
      opts.sessionId,
      resumeId,
      opts.cwd,
    )
    trace('backend.lifecycle', 'resume_target_unusable', { state, providerSessionId: resumeId, cwd: opts.cwd })
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.bridge) throw new Error('ClaudeBackend already started')
    // A turn id belongs to the runtime that produced it. `iterateMessages` seeds
    // its open turn from `getCurrentMessageId()`, so letting a finished turn's id
    // survive a release/rebuild makes the replacement loop treat that closed
    // message as the live one — a wake that opens no turn of its own (mailbox
    // notification after the idle reaper) then streams into the previous bubble
    // with no `message_start` and no `streaming` status.
    this.currentMessageId = ''
    this.currentStartTime = 0
    this._lastStartOpts = opts
    this._spawnedAdditionalDirs = [...(opts.additionalDirectories ?? [])]
    const config = (opts.config ?? {}) as ClaudeConfig
    // Must be reassigned on every start, not only when a proxy exists: the same
    // backend instance is reused across provider switches, so a leftover url
    // would keep pointing ANTHROPIC_BASE_URL at the sidecar (possibly already
    // reaped by the idle sweep) after switching back to a direct provider.
    this._proxyBaseUrl = config.proxy ? (await ensureProxy(config.proxy)).url : null
    this.bridge = new MessageBridge()
    this.bridge.onConsumed = (tag) => {
      this.emit({ type: 'queued_message_consumed', clientMessageId: tag })
    }
    this.providerSessionId = opts.providerSessionId ?? null
    this.stagedProviderSessionId = null
    this.warnOnUnusableResumeTarget(opts)

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
      (id) => this.stageProviderSessionId(id),
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
  }

  /**
   * Push a machine wake-up via Claude Agent SDK provenance
   * `origin: { kind: 'task-notification' }` (not a human composer message).
   * Uses priority `next` so an in-flight turn is not interrupted.
   *
   * Always `sent-inline` (both the immediate push and the in-turn queue land in
   * the SDK stream, never in Session.send), so Session mirrors the bubble.
   */
  async injectTaskNotification(content: string): Promise<TaskNotificationInjectResult> {
    await this.ensureRuntime()
    if (!this.bridge) throw new Error('ClaudeBackend not started')
    const userMsg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      uuid: randomUUID(),
      session_id: this.providerSessionId ?? '',
      origin: { kind: 'task-notification' },
      isSynthetic: true,
      priority: 'next',
    }
    const tag = `task-notify-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.beginTurn()
    // Always handled in-process (queue or push) — never starts a Session-level turn.
    if (this.turnResolves.size > 0) {
      this.pendingQueued.push({ msg: userMsg, clientMessageId: tag })
    } else {
      this.bridge.push(userMsg, tag)
    }
    return 'sent-inline'
  }

  async send(request: SendMessageRequest): Promise<void> {
    await this.ensureRuntime()
    if (!this.bridge || !this.query) throw new Error('ClaudeBackend not started')

    const isQueued = request.priority === 'next'
    if (isQueued) {
      this.beginTurn()
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
    this.beginTurn()

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
    this.beginTurn()
    for (const item of this.pendingQueued) {
      this.bridge.push(item.msg, item.clientMessageId)
    }
    this.pendingQueued = []
  }

  /**
   * A newly started turn always outranks a stale interrupt latch. Without this
   * a queued (priority=next) send inherited `interrupted` from the previous
   * turn, and `iterateMessages` silently dropped everything the new turn
   * produced — the agent ran on while the UI stayed frozen mid-stream.
   */
  private beginTurn(): void {
    this.interrupted = false
    this.clearInterruptWatchdog()
  }

  private clearInterruptWatchdog(): void {
    if (!this.interruptSettleTimer) return
    clearTimeout(this.interruptSettleTimer)
    this.interruptSettleTimer = null
  }

  /**
   * Guarantee a terminal event for an acked-but-unsettled interrupt: emit
   * `message_interrupted` locally and replace the wedged CLI process, so the
   * renderer can always leave the streaming state.
   */
  private armInterruptWatchdog(): void {
    this.clearInterruptWatchdog()
    const messageId = this.currentMessageId
    if (!messageId) return
    this.interruptSettleTimer = setTimeout(() => {
      this.interruptSettleTimer = null
      if (!this.interrupted || this.currentMessageId !== messageId) return
      log.warn(
        '[ClaudeBackend] interrupt acked but turn never settled within %dms (messageId=%s); forcing terminal event and rebuilding runtime',
        INTERRUPT_SETTLE_TIMEOUT_MS,
        messageId,
      )
      this.emit({
        type: 'message_interrupted',
        messageId,
        metadata: { durationMs: this.currentStartTime ? Date.now() - this.currentStartTime : undefined },
      })
      void this.releaseRuntime('rebuild')
    }, INTERRUPT_SETTLE_TIMEOUT_MS)
    this.interruptSettleTimer.unref?.()
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    this.pendingQueued = []
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, this.pendingElicitations, 'backend.interrupt')
    if (this.query) {
      try {
        const query = this.query as Query & {
          cancelAsyncMessage?: (uuid: string) => Promise<boolean>
        }
        const receipt = await withDeadline(query.interrupt(), INTERRUPT_ACK_TIMEOUT_MS)
        if (receipt === DEADLINE_EXCEEDED) {
          log.warn('[ClaudeBackend] interrupt was not acked within %dms; rebuilding runtime to guarantee stop', INTERRUPT_ACK_TIMEOUT_MS)
          await this.releaseRuntime('rebuild')
          return
        }
        if (!receipt) {
          log.warn('[ClaudeBackend] interrupt receipt unavailable; rebuilding runtime to guarantee stop')
          await this.releaseRuntime('rebuild')
          return
        }
        const queued = receipt?.still_queued ?? []
        if (queued.length > 0) {
          if (!query.cancelAsyncMessage) {
            log.warn('[ClaudeBackend] interrupt left %d queued message(s), but SDK cancellation is unavailable', queued.length)
            await this.releaseRuntime('rebuild')
            return
          }
          const cancelled = await Promise.allSettled(queued.map((uuid) => query.cancelAsyncMessage!(uuid)))
          if (cancelled.some((result) => result.status === 'rejected' || result.value !== true)) {
            log.warn('[ClaudeBackend] interrupt could not cancel every queued message; rebuilding runtime')
            await this.releaseRuntime('rebuild')
            return
          }
        }
        this.armInterruptWatchdog()
      } catch (err) {
        log.debug('[ClaudeBackend] interrupt error:', err)
        await this.releaseRuntime('rebuild')
      }
    }
  }

  async close(): Promise<void> {
    await this.releaseRuntime('close')
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
    this.permissionModeAppliedListeners.clear()
  }

  async releaseRuntime(reason: 'idle' | 'rebuild' | 'close'): Promise<void> {
    if (!this.bridge && !this.query) return
    if (reason === 'idle' && (
      this.pendingPermissions.size > 0
      || this.pendingQuestions.size > 0
      || this.pendingPlanApprovals.size > 0
      || this.pendingElicitations.size > 0
      || this.turnResolves.size > 0
      || this.pendingQueued.length > 0
      || this.hasActiveBackgroundTasks()
    )) return
    // A replaced runtime carries no in-flight turn: never let the latch outlive it.
    this.beginTurn()
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
    this.stagedProviderSessionId = null
    for (const resolve of this.turnResolves.values()) resolve()
    this.turnResolves.clear()
    this.pendingQueued = []
    rejectAllPending(this.pendingPermissions, this.pendingQuestions, this.pendingPlanApprovals, this.pendingElicitations, `backend.${reason}`)
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

  respondToPermission(requestId: string, allow: boolean, alwaysAllow?: boolean, reason?: string, selectedSuggestions?: number[], decision?: 'cancel', formAnswers?: Record<string, unknown>): boolean {
    if (decision === 'cancel') {
      if (rejectVideoConfirm(requestId, 'User cancelled')) return true
      if (rejectConfigConfirm(requestId, 'User cancelled')) return true
      if (rejectComputerUseGrant(requestId, 'User cancelled')) return true
    }
    if (resolveVideoConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) return true
    if (resolveConfigConfirm(requestId, allow ? 'accept' : 'decline', formAnswers)) return true
    if (resolveComputerUseGrant(requestId, allow, alwaysAllow)) return true
    if (this.pendingElicitations.has(requestId)) {
      return respondToElicitationInternal(this.pendingElicitations, requestId, allow, decision, formAnswers)
    }
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
    for (const e of this.pendingElicitations.values()) events.push(e.event)
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

  hasActiveBackgroundTasks(): boolean {
    if ((this.activeBackgroundTasks?.size ?? 0) > 0) return true
    const sid = this._lastStartOpts?.sessionId
    return sid ? hasRunningDownloadTasks(sid) : false
  }

  private emit(event: AgentEvent): void {
    if (
      this.stagedProviderSessionId
      && (event.type === 'content_delta' || event.type === 'message_complete' || event.type === 'message_interrupted')
    ) {
      this.commitProviderSessionId(this.stagedProviderSessionId)
    }
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
      // The turn is over: the latch has served its purpose and must not leak
      // into the next one (see beginTurn).
      this.beginTurn()
      const resolve = this.turnResolves.get(mid)
      if (resolve) {
        resolve()
        this.turnResolves.delete(mid)
      }
    }
  }
}
