import type {
  AgentEvent,
  ContextUsageInfo,
  McpServerInfo,
  PermissionMode,
  ProviderRateLimits,
  QuestionAnnotations,
  RewindFilesResult,
  SandboxInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import log from '../../logger'
import { recordGrokFromUsage } from '../../usage-stats-service'
import { resolveComputerUseGrant, rejectComputerUseGrant } from '../../computer-use/grant-request'
import {
  extractModeConfig,
  extractModelConfig,
  type AcpModeConfig,
  type AcpModelConfig,
} from '../../acp/acp-config'
import {
  upsertAcpAgentConfig,
  upsertAcpAgentModels,
  upsertAcpAgentModes,
  upsertAcpAgentSlashCommands,
} from '../../acp/acp-model-cache'
import { createAcpRuntime, type AcpRuntime, type AcpRuntimeOptions } from '../../acp/acp-runtime'
import { notifySessionRecapReceived } from '../../acp/acp-recap-focus'
import { mapPermissionDecision, mapPermissionRequest, type PendingPermissionOptions } from '../../acp/acp-permission-map'
import { shouldAutoAllowAcpPermission } from '../../acp/acp-permission-preapprove'
import {
  buildAskUserQuestionRequest,
  buildPlanApprovalRequest,
  formatGrokAskUserResponse,
  formatGrokExitPlanModeResponse,
  type GrokAskUserAnswer,
  type GrokAskUserQuestionParams,
  type GrokExitPlanModeAnswer,
  type GrokExitPlanModeParams,
} from '../../acp/acp-xai-extensions'
import {
  TaskNotificationFlush,
  TaskNotificationQueue,
  taskNotificationRequest,
} from '../task-notification-queue'
import type { BackendStartOptions, HarnessId, SessionBackend } from '../types'

export interface AcpBackendConfig {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type AcpRuntimeFactory = (opts: AcpRuntimeOptions) => Promise<AcpRuntime>

function readConfig(raw: unknown): AcpBackendConfig {
  if (raw && typeof raw === 'object') return raw as AcpBackendConfig
  return {}
}

let runtimeFactory: AcpRuntimeFactory = createAcpRuntime

export function setAcpRuntimeFactory(factory: AcpRuntimeFactory | null): void {
  runtimeFactory = factory ?? createAcpRuntime
}

export class AcpBackend implements SessionBackend {
  readonly kind: HarnessId = 'acp'

  hasActiveRuntime(): boolean {
    return Boolean(this.runtime || this.ensureRuntimePromise)
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {
    if (this.activePrompt || this.pendingQueued.length > 0) return
    if (this.getPendingInteractions().length > 0) return
    await this.teardownRuntime()
  }

  private started = false
  private disposed = false
  private startOpts: BackendStartOptions | null = null
  private config: AcpBackendConfig = {}
  private runtime: AcpRuntime | null = null
  private activePrompt: Promise<void> | null = null
  /** User messages sent mid-turn, replayed in order once the live turn settles. */
  private pendingQueued: SendMessageRequest[] = []
  private readonly pendingTaskNotifications = new TaskNotificationQueue()
  /** Overridden by Session → Session.send / _sendChain for idle flushes. */
  private taskNotificationSender: (content: string) => Promise<void> = (content) =>
    this.send(taskNotificationRequest(content))
  private readonly taskNotificationFlush = new TaskNotificationFlush(
    this.pendingTaskNotifications,
    {
      isBusy: () => Boolean(this.activePrompt),
      isAlive: () => this.started && !this.disposed,
      send: (content) => this.taskNotificationSender(content),
    },
    {
      logLabel: 'AcpBackend',
      warn: (message) => log.warn(message),
    },
  )
  private interrupted = false
  private currentMessageId: string | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()
  private permissionModeAppliedListeners = new Set<(mode: PermissionMode) => void>()

  private pendingPermissions = new Map<string, {
    resolve: (response: RequestPermissionResponse) => void
    options: PendingPermissionOptions[]
    event: AgentEvent
  }>()

  private pendingQuestions = new Map<string, {
    resolve: (answer: GrokAskUserAnswer) => void
    event: AgentEvent
  }>()

  private pendingPlanApprovals = new Map<string, {
    resolve: (answer: GrokExitPlanModeAnswer) => void
    event: AgentEvent
  }>()

  private modelConfigId: string | null = null
  private modeConfigId: string | null = null
  /** Last known selected model (needed for Grok set_model / effort without configId). */
  private selectedModelId: string | null = null
  /** Last known mode/effort options when configId is null (Grok reasoning effort). */
  private lastModeConfig: AcpModeConfig | null = null
  private ensureRuntimePromise: Promise<AcpRuntime> | null = null
  /**
   * Resume id passed to the in-flight / last completed runtime factory call.
   * Used to avoid re-spawning when session/load already failed for that id.
   */
  private lastSpawnResumeId: string | null = null
  private runtimeAbortController: AbortController | null = null
  private runtimeEpoch = 0
  private runtimeAgentKey: string | null = null
  /** Cwd the live ACP process was started with (session/new). */
  private runtimeCwd: string | null = null
  /**
   * Provider session ids we already forced a cold restart for (wanted resume ≠ live id).
   * Prevents an infinite teardown loop when session/load keeps failing.
   */
  private resumeForceAttempted = new Set<string>()

  private agentKey(cfg: AcpBackendConfig = this.config): string {
    return `${cfg.agentId ?? ''}\0${cfg.command ?? ''}`
  }

  private isLaunchChanged(next: AcpBackendConfig): boolean {
    return this.agentKey(next) !== this.agentKey(this.config)
  }

  private effectiveCwd(opts: BackendStartOptions): string {
    return (opts.cwd?.trim() || opts.projectPath).trim()
  }

  /** Agent id/command change OR working directory change requires a new ACP process. */
  private needsRuntimeRestart(opts: BackendStartOptions): boolean {
    if (this.isLaunchChanged(readConfig(opts.config))) return true
    if (!this.runtime && !this.ensureRuntimePromise) return false
    const nextCwd = this.effectiveCwd(opts)
    if (this.runtimeCwd && this.runtimeCwd !== nextCwd) return true
    if (this.startOpts && this.effectiveCwd(this.startOpts) !== nextCwd) return true
    return false
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.disposed) throw new Error('AcpBackend already disposed')
    const next = readConfig(opts.config)
    const restart = this.needsRuntimeRestart(opts) || this.isLaunchChanged(next)
    this.startOpts = opts
    this.config = next
    if (restart && (this.runtime || this.ensureRuntimePromise)) {
      await this.teardownRuntime()
    }
    this.started = true
    log.info(
      '[AcpBackend] start sid=%s agentId=%s cwd=%s',
      opts.sessionId,
      this.config.agentId ?? '(none)',
      this.effectiveCwd(opts),
    )
    // Spawn early so available_commands_update can fill the / popup before the first send.
    void this.ensureRuntime().catch((err) => {
      log.warn('[AcpBackend] start ensureRuntime failed:', err instanceof Error ? err.message : String(err))
    })
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    await this.teardownRuntime()
    this.startOpts = opts
    this.config = readConfig(opts.config)
    this.started = true
    this.disposed = false
    log.info(
      '[AcpBackend] rebuild sid=%s agentId=%s cwd=%s',
      opts.sessionId,
      this.config.agentId ?? '(none)',
      this.effectiveCwd(opts),
    )
    // Re-spawn so worktree/cwd switches take effect before the next prompt
    // (Grok binds cwd at session/new; a cold start on send is too late if UI
    // already showed tools from the previous project root).
    void this.ensureRuntime().catch((err) => {
      log.warn('[AcpBackend] rebuild ensureRuntime failed:', err instanceof Error ? err.message : String(err))
    })
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.disposed) return
    const next = readConfig(opts.config)
    const restart = this.needsRuntimeRestart(opts)
    if (restart && (this.runtime || this.ensureRuntimePromise)) {
      void this.teardownRuntime().then(() => {
        this.startOpts = opts
        this.config = next
        return this.ensureRuntime()
      }).catch((err) => {
        log.warn('[AcpBackend] prewarm rebuild failed:', err instanceof Error ? err.message : String(err))
      })
      return
    }
    this.startOpts = opts
    this.config = next
    void this.ensureRuntime().catch((err) => {
      log.warn('[AcpBackend] prewarm failed:', err instanceof Error ? err.message : String(err))
    })
  }

  private persistConfigCache(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    modelFallback: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    } | null,
    agentId: string | null,
  ): void {
    if (!agentId) return
    try {
      if (configOptions?.length) {
        upsertAcpAgentConfig(agentId, configOptions, modelFallback)
      } else if (modelFallback && modelFallback.models.length > 0) {
        upsertAcpAgentModels(agentId, modelFallback)
      }
    } catch (err) {
      log.debug('[AcpBackend] upsert config cache failed:', err)
    }
  }

  private emitModels(
    extracted: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    },
    agentId: string | null,
    epoch: number,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    if (agentId !== (this.config.agentId ?? null)) return
    this.modelConfigId = extracted.configId
    this.selectedModelId = extracted.selectedModelId
    this.emit({
      type: 'acp_models',
      models: extracted.models,
      selectedModelId: extracted.selectedModelId,
      configId: extracted.configId,
      status: 'ready',
      agentId,
    })
  }

  private emitModes(
    extracted: AcpModeConfig | null,
    agentId: string | null,
    epoch: number,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    if (!extracted || extracted.modes.length === 0) {
      this.modeConfigId = null
      this.lastModeConfig = null
      this.emit({
        type: 'acp_modes',
        modes: [],
        selectedModeId: null,
        configId: null,
        status: 'ready',
        agentId,
      })
      return
    }
    this.modeConfigId = extracted.configId
    this.lastModeConfig = extracted
    if (agentId) {
      try {
        upsertAcpAgentModes(agentId, extracted)
      } catch (err) {
        log.debug('[AcpBackend] upsert mode cache failed:', err)
      }
    }
    this.emit({
      type: 'acp_modes',
      modes: extracted.modes,
      selectedModeId: extracted.selectedModeId,
      configId: extracted.configId,
      status: 'ready',
      agentId,
    })
  }

  private emitModesFromConfigOptions(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    agentId: string | null,
    epoch: number,
    modeFallback?: AcpModeConfig | null,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    const extracted = extractModeConfig(configOptions)
      ?? (modeFallback && modeFallback.modes.length > 0 ? modeFallback : null)
    this.emitModes(extracted, agentId, epoch)
  }

  private emitConfigFromOptions(
    configOptions: import('@agentclientprotocol/sdk').SessionConfigOption[] | null | undefined,
    agentId: string | null,
    epoch: number,
    modelFallback?: {
      models: import('@superone/shared/agent-types').ModelOption[]
      selectedModelId: string | null
      configId: string | null
    } | null,
  ): void {
    if (epoch !== this.runtimeEpoch) return
    const models = extractModelConfig(configOptions)
      ?? (modelFallback && modelFallback.models.length > 0 ? modelFallback : null)
    this.persistConfigCache(configOptions, models, agentId)
    if (models && models.models.length > 0) {
      this.emitModels(models, agentId, epoch)
    } else {
      this.modelConfigId = null
      this.emit({
        type: 'acp_models',
        models: [],
        selectedModelId: null,
        configId: null,
        status: 'ready',
        agentId,
      })
    }
    this.emitModesFromConfigOptions(configOptions, agentId, epoch)
  }

  private emitConfigFromRuntime(runtime: AcpRuntime, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    const options = runtime.getConfigOptions()
    const modelFallback = runtime.getModelConfig() ?? extractModelConfig(options)
    this.emitConfigFromOptions(options, agentId, epoch, modelFallback)
    // Grok effort options live outside standard configOptions.
    if (!this.modeConfigId) {
      const modeFallback = runtime.getModeConfig()
      if (modeFallback?.modes.length) {
        this.emitModes(modeFallback, agentId, epoch)
      }
    }
  }

  private emitModelsError(error: string, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    this.modelConfigId = null
    this.modeConfigId = null
    this.selectedModelId = null
    this.lastModeConfig = null
    this.emit({
      type: 'acp_models',
      models: [],
      selectedModelId: null,
      configId: null,
      status: 'error',
      error,
      agentId,
    })
    this.emit({
      type: 'acp_modes',
      modes: [],
      selectedModeId: null,
      configId: null,
      status: 'error',
      error,
      agentId,
    })
  }

  /**
   * When live/in-flight runtime id ≠ wanted resume, decide whether to force one
   * session/load restart. Skip if we already spawned with that resume id (load
   * failed and fell back to session/new) — another attempt would only mint more sessions.
   */
  private shouldForceResumeRestart(
    runtime: AcpRuntime,
    wantedResume: string,
  ): boolean {
    if (!wantedResume || runtime.sessionId === wantedResume) return false
    if (this.resumeForceAttempted.has(wantedResume)) return false
    // Spawn already tried session/load for this id; accept the new live id.
    if (this.lastSpawnResumeId === wantedResume) {
      this.resumeForceAttempted.add(wantedResume)
      if (this.startOpts) {
        this.startOpts = { ...this.startOpts, providerSessionId: runtime.sessionId }
      }
      log.warn(
        '[AcpBackend] session/load already attempted for resume=%s (live=%s) — accepting new id sid=%s',
        wantedResume,
        runtime.sessionId,
        this.startOpts?.sessionId,
      )
      return false
    }
    return true
  }

  private adoptLiveProviderSessionId(runtime: AcpRuntime, resumeAtSpawn: string | undefined): void {
    if (!this.startOpts) return
    const wanted = this.startOpts.providerSessionId?.trim() || ''
    if (
      !wanted
      || wanted === runtime.sessionId
      || this.resumeForceAttempted.has(wanted)
      || (resumeAtSpawn && resumeAtSpawn === wanted && runtime.sessionId !== wanted)
    ) {
      if (wanted && wanted !== runtime.sessionId) {
        this.resumeForceAttempted.add(wanted)
      }
      this.startOpts = { ...this.startOpts, providerSessionId: runtime.sessionId }
    }
  }

  private async ensureRuntime(): Promise<AcpRuntime> {
    if (!this.startOpts) throw new Error('AcpBackend missing startOpts')
    const desiredCwd = this.effectiveCwd(this.startOpts)
    const wantedResume = this.startOpts.providerSessionId?.trim() || ''
    if (
      this.runtime
      && this.runtimeAgentKey === this.agentKey()
      && this.runtimeCwd === desiredCwd
    ) {
      // Live runtime but cold-started without the stored provider session id.
      // Force one session/load attempt when we know the wanted resume id.
      if (this.shouldForceResumeRestart(this.runtime, wantedResume)) {
        log.warn(
          '[AcpBackend] live runtime id=%s ≠ wanted resume=%s — restarting for session/load sid=%s',
          this.runtime.sessionId,
          wantedResume,
          this.startOpts.sessionId,
        )
        this.resumeForceAttempted.add(wantedResume)
        await this.teardownRuntime()
      } else {
        return this.runtime
      }
    }
    if (this.runtime) {
      await this.teardownRuntime()
    }
    if (this.ensureRuntimePromise) {
      const pending = this.ensureRuntimePromise
      const runtime = await pending
      // If a concurrent start/prewarm filled providerSessionId after this spawn began
      // without a resume id, tear down once and respawn so session/load can run.
      const wantedAfter = this.startOpts?.providerSessionId?.trim() || ''
      if (
        this.shouldForceResumeRestart(runtime, wantedAfter)
        && this.runtime === runtime
      ) {
        log.warn(
          '[AcpBackend] in-flight runtime id=%s ≠ wanted resume=%s — restarting for session/load sid=%s',
          runtime.sessionId,
          wantedAfter,
          this.startOpts?.sessionId,
        )
        this.resumeForceAttempted.add(wantedAfter)
        await this.teardownRuntime()
      } else {
        return runtime
      }
    }
    if (!this.config.agentId && !this.config.command) {
      throw new Error('No ACP agent configured. Pick an agent under Others, then try again.')
    }
    const epoch = this.runtimeEpoch
    const abortController = new AbortController()
    this.runtimeAbortController = abortController
    const agentId = this.config.agentId ?? null
    const launchKey = this.agentKey()
    // Prefer startOpts.cwd (session/worktree) over provider config cwd overrides.
    const launch = {
      agentId: this.config.agentId,
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
      cwd: undefined as string | undefined,
      defaultCwd: desiredCwd,
    }
    this.emit({
      type: 'acp_models',
      models: [],
      selectedModelId: null,
      configId: null,
      status: 'loading',
      agentId,
    })
    this.emit({
      type: 'acp_modes',
      modes: [],
      selectedModeId: null,
      configId: null,
      status: 'loading',
      agentId,
    })
    // Re-read startOpts at spawn time (start/prewarm may refresh providerSessionId
    // after an earlier ensureRuntimePromise was scheduled with a stale empty resume).
    const resumeSessionId = this.startOpts?.providerSessionId?.trim() || undefined
    log.info(
      '[AcpBackend] ensureRuntime sid=%s agent=%s resume=%s cwd=%s',
      this.startOpts?.sessionId,
      agentId ?? '(none)',
      resumeSessionId ?? '(none)',
      desiredCwd,
    )
    const promise = (async () => {
      // Prefer the latest startOpts at the moment we actually call the factory —
      // a concurrent start() may have filled providerSessionId after prewarm queued us.
      const resumeAtSpawn = this.startOpts?.providerSessionId?.trim() || resumeSessionId
      this.lastSpawnResumeId = resumeAtSpawn ?? null
      const runtime = await runtimeFactory({
        signal: abortController.signal,
        launch,
        superoneSessionId: this.startOpts?.sessionId,
        permissionMode: this.startOpts?.permissionMode,
        systemPromptAppend: this.startOpts?.systemPromptAppend,
        // Resume Grok/ACP agent memory when we have a stored provider session id.
        resumeSessionId: resumeAtSpawn,
        permission: {
          request: (params) => this.handlePermissionRequest(params),
        },
        askUserQuestion: {
          request: (params) => this.handleAskUserQuestion(params),
        },
        exitPlanMode: {
          request: (params) => this.handleExitPlanMode(params),
        },
        onModelConfig: (cfg) => {
          // Early model discovery (initialize) before session/new configOptions land.
          this.emitModels(cfg, agentId, epoch)
          this.persistConfigCache(null, cfg, agentId)
        },
        onModeConfig: (cfg) => {
          this.emitModes(cfg, agentId, epoch)
        },
        onSessionEvent: (event) => {
          if (epoch !== this.runtimeEpoch) return
          this.routeSessionEvent(event, agentId, epoch)
        },
      })
      if (epoch !== this.runtimeEpoch || this.agentKey() !== launchKey) {
        try { await runtime.close() } catch { /* ignore */ }
        throw new Error('ACP runtime superseded by agent switch')
      }
      this.runtime = runtime
      this.runtimeAgentKey = launchKey
      this.runtimeCwd = runtime.launch.cwd || desiredCwd
      // Keep startOpts in sync with the live agent id after load success or
      // failed-load fallback so force-retry does not mint extra sessions.
      this.adoptLiveProviderSessionId(runtime, resumeAtSpawn)
      log.info(
        '[AcpBackend] runtime ready sid=%s agent=%s providerSessionId=%s cwd=%s',
        this.startOpts?.sessionId,
        agentId ?? '(none)',
        runtime.sessionId,
        this.runtimeCwd,
      )
      for (const cb of this.providerSessionIdListeners) {
        try { cb(runtime.sessionId) } catch (err) { log.warn('[AcpBackend] providerSessionId listener error:', err) }
      }
      // The listeners above only reach the DB. The renderer learns the real id from this event.
      this.emit({ type: 'provider_session_id', providerSessionId: runtime.sessionId })
      this.emitConfigFromRuntime(runtime, agentId, epoch)
      return runtime
    })()
    this.ensureRuntimePromise = promise
    try {
      return await promise
    } catch (err) {
      if (epoch === this.runtimeEpoch) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('superseded')) this.emitModelsError(msg, agentId, epoch)
      }
      throw err
    } finally {
      if (this.ensureRuntimePromise === promise) this.ensureRuntimePromise = null
      if (this.runtimeAbortController === abortController) this.runtimeAbortController = null
    }
  }

  private routeSessionEvent(event: AgentEvent, agentId: string | null, epoch: number): void {
    if (epoch !== this.runtimeEpoch) return
    if (event.type === 'session_recap') {
      // Stop further auto recap attempts for this session's away period.
      const sid = this.startOpts?.sessionId?.trim()
      if (sid) notifySessionRecapReceived(sid)
      else log.debug('[AcpBackend] session_recap mark-shown skipped — no SuperOne sessionId')
    }
    if (event.type === 'acp_models') {
      this.modelConfigId = event.configId ?? null
      if (event.selectedModelId) this.selectedModelId = event.selectedModelId
    }
    if (event.type === 'agent_setting_change' && event.selectedModel) {
      this.selectedModelId = event.selectedModel
    }
    if (event.type === 'acp_modes') {
      this.modeConfigId = event.configId ?? null
    }
    if (event.type === 'acp_commands') {
      if (agentId) {
        try {
          // Always persist (including empty) so cache mirrors agent-advertised set.
          upsertAcpAgentSlashCommands(agentId, event.commands)
        } catch (err) {
          log.debug('[AcpBackend] upsert slash commands cache failed:', err)
        }
      }
      log.info(
        '[AcpBackend] acp_commands agent=%s count=%d names=%s',
        agentId ?? '(none)',
        event.commands.length,
        event.commands.slice(0, 12).map((c) => c.name).join(','),
      )
    }
    if (
      agentId === 'grok-build'
      && event.type === 'message_usage'
      && (event.inputTokens > 0 || event.outputTokens > 0 || (event.cacheReadTokens ?? 0) > 0)
    ) {
      const model = this.selectedModelId ?? this.startOpts?.model ?? 'grok'
      const usageEvent = { ...event, model }
      try {
        recordGrokFromUsage(usageEvent, model, new Date())
      } catch (err) {
        log.warn('[AcpBackend] Grok usage stats write failed:', err)
      }
      this.emit(usageEvent)
      return
    }
    if (
      (event.type === 'acp_models' || event.type === 'acp_modes' || event.type === 'acp_commands')
      && event.agentId === undefined
    ) {
      this.emit({ ...event, agentId })
      return
    }
    this.emit(event)
  }

  private handlePermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const { request, options } = mapPermissionRequest(params)
    // Host built-ins + mini-app preapprovals must not block Grok turns (Claude parity).
    const pre = shouldAutoAllowAcpPermission(params)
    if (pre.allow) {
      // Built-ins: prefer allow_always / allow-always-mcp so Grok stops re-prompting
      // the same host tool. Mini-app preapprovals stay one-shot (tool-scoped list).
      const alwaysAllow = pre.reason === 'builtin'
      log.info(
        '[AcpBackend] auto-allow permission tool=%s reason=%s always=%s requestId=%s',
        pre.toolName,
        pre.reason,
        alwaysAllow,
        request.requestId,
      )
      return Promise.resolve(mapPermissionDecision(options, true, alwaysAllow))
    }
    const event: AgentEvent = { type: 'permission_request', request }
    return new Promise((resolve) => {
      this.pendingPermissions.set(request.requestId, { resolve, options, event })
      this.emit(event)
    })
  }

  private handleAskUserQuestion(params: GrokAskUserQuestionParams): Promise<Record<string, unknown>> {
    const requestId =
      (typeof params.toolCallId === 'string' && params.toolCallId)
      || `acp_ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const request = buildAskUserQuestionRequest(params, requestId)
    if (request.questions.length === 0) {
      log.warn('[AcpBackend] ask_user_question with empty questions — cancelling')
      return Promise.resolve(formatGrokAskUserResponse({ kind: 'cancelled' }))
    }
    const event: AgentEvent = { type: 'ask_user_question', request }
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, {
        resolve: (answer) => resolve(formatGrokAskUserResponse(answer)),
        event,
      })
      this.emit(event)
    })
  }

  private handleExitPlanMode(params: GrokExitPlanModeParams): Promise<Record<string, unknown>> {
    const requestId =
      (typeof params.toolCallId === 'string' && params.toolCallId)
      || `acp_plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // Replace a prior parked plan approval (Grok may re-issue on resume).
    const prev = this.pendingPlanApprovals.get(requestId)
    if (prev) {
      this.pendingPlanApprovals.delete(requestId)
      prev.resolve({ kind: 'abandoned' })
    }
    for (const [id, pending] of this.pendingPlanApprovals) {
      this.pendingPlanApprovals.delete(id)
      pending.resolve({ kind: 'abandoned' })
    }
    const request = buildPlanApprovalRequest(params, requestId)
    const event: AgentEvent = { type: 'plan_approval', request }
    log.info(
      '[AcpBackend] exit_plan_mode requestId=%s planChars=%d',
      requestId,
      request.planContent.length,
    )
    return new Promise((resolve) => {
      this.pendingPlanApprovals.set(requestId, {
        resolve: (answer) => resolve(formatGrokExitPlanModeResponse(answer)),
        event,
      })
      this.emit(event)
    })
  }

  private rejectPendingQuestions(): void {
    for (const [, pending] of this.pendingQuestions) {
      pending.resolve({ kind: 'cancelled' })
    }
    this.pendingQuestions.clear()
  }

  private rejectPendingPlanApprovals(reason: 'cancelled' | 'abandoned' = 'abandoned'): void {
    for (const [, pending] of this.pendingPlanApprovals) {
      pending.resolve(reason === 'cancelled' ? { kind: 'cancelled' } : { kind: 'abandoned' })
    }
    this.pendingPlanApprovals.clear()
  }

  bindTaskNotificationSend(send: (content: string) => Promise<void>): void {
    this.taskNotificationSender = send
  }

  /**
   * Mid-turn queue only. Idle synthetic turns are owned by Session.send.
   * ACP has no mid-turn inject / steer.
   */
  async injectTaskNotification(content: string): Promise<boolean> {
    if (!this.started || this.disposed) return true
    const text = content.trim()
    if (!text) return true
    if (this.isTurnBusy()) {
      this.pendingTaskNotifications.enqueue(text)
      return true
    }
    return false
  }

  /**
   * Set from the first synchronous line of `send()` until the turn settles, so
   * a queued message can never slip into the window between `send()` and the
   * `await ensureRuntime()` that assigns `activePrompt`.
   */
  private isTurnBusy(): boolean {
    return this.currentMessageId !== null || this.activePrompt !== null
  }

  private flushPendingTaskNotifications(): void {
    this.taskNotificationFlush.flush()
  }

  /**
   * ACP has no steer: a second `session/prompt` while one is in flight makes the
   * agent end the live turn with `stopReason: cancelled`. So a queued user
   * message waits here and runs as its own turn once the live one settles.
   */
  private flushPendingQueued(): void {
    if (this.pendingQueued.length === 0) return
    if (!this.started || this.disposed) {
      this.pendingQueued = []
      return
    }
    // Re-enters send() with `priority: 'next'` while idle, which is where the
    // consumed event is emitted.
    void this.send(this.pendingQueued.shift()!).catch((err) => {
      log.warn('[AcpBackend] queued send failed:', err)
    })
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('AcpBackend not started')
    if (request.priority === 'next') {
      if (this.isTurnBusy()) {
        this.pendingQueued.push(request)
        return
      }
      // Session holds the user bubble until this lands, so it must be emitted
      // on every path that actually runs a queued message — including the race
      // where the turn settled between Session's streaming check and here.
      if (request.clientMessageId) {
        this.emit({ type: 'queued_message_consumed', clientMessageId: request.clientMessageId })
      }
    }
    const messageId = request.assistantMessageId
      ?? `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interrupted = false
    this.currentMessageId = messageId

    this.emit({
      type: 'message_start',
      message: {
        id: messageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })

    let emittedTerminal = false
    const onEvent = (event: AgentEvent) => {
      if (
        event.type === 'message_complete'
        || event.type === 'message_interrupted'
        || event.type === 'message_error'
      ) {
        emittedTerminal = true
      }
      this.routeSessionEvent(event, this.config.agentId ?? null, this.runtimeEpoch)
    }

    try {
      const runtime = await this.ensureRuntime()
      if (request.model) {
        try {
          // Prefer turn-level effort (Claude field / Grok mode id string) then lastModeConfig.
          const turnEffort =
            typeof request.effort === 'string' ? request.effort.trim() : ''
          await this.applyModel(runtime, request.model, {
            reasoningEffort: turnEffort || undefined,
          })
        } catch (err) {
          log.debug('[AcpBackend] set model before prompt failed:', err)
        }
      }
      const turn = runtime.prompt(request.content, messageId, onEvent, request.images)
      this.activePrompt = turn
      await turn
    } catch (err) {
      if (this.interrupted) {
        if (!emittedTerminal) {
          this.emit({ type: 'message_interrupted', messageId })
          this.emit({ type: 'status_change', status: 'idle' })
        }
        return
      }
      if (!emittedTerminal) {
        const error = err instanceof Error ? err.message : String(err)
        this.emit({ type: 'message_error', messageId, error })
        this.emit({ type: 'status_change', status: 'error' })
      }
    } finally {
      this.activePrompt = null
      this.currentMessageId = null
      // User-typed messages outrank host task notifications; the notification
      // flush re-queues itself while the queued turn holds the runtime.
      this.flushPendingQueued()
      this.flushPendingTaskNotifications()
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    this.pendingQueued = []
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    this.rejectPendingQuestions()
    this.rejectPendingPlanApprovals('abandoned')
    if (!this.runtime && this.ensureRuntimePromise) {
      // send() is parked on ensureRuntime(); a stalled spawn (Grok retrying its
      // settings fetch) has no session to cancel, so abort the spawn instead —
      // otherwise Stop is a no-op and the turn streams forever.
      log.info('[AcpBackend] interrupt during runtime spawn — aborting spawn sid=%s', this.startOpts?.sessionId)
      await this.teardownRuntime()
      return
    }
    try {
      await this.runtime?.cancel()
    } catch (err) {
      log.debug('[AcpBackend] interrupt cancel error:', err)
    }
  }

  private async teardownRuntime(): Promise<void> {
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    this.rejectPendingQuestions()
    this.rejectPendingPlanApprovals('abandoned')
    const pending = this.ensureRuntimePromise
    const abortController = this.runtimeAbortController
    this.runtimeEpoch += 1
    this.ensureRuntimePromise = null
    this.runtimeAbortController = null
    abortController?.abort()
    this.modelConfigId = null
    this.modeConfigId = null
    this.selectedModelId = null
    this.lastModeConfig = null
    this.runtimeAgentKey = null
    this.runtimeCwd = null
    const runtime = this.runtime
    this.runtime = null
    if (runtime) {
      try { await runtime.close() } catch (err) { log.debug('[AcpBackend] runtime close error:', err) }
    }
    if (pending) {
      try { await pending } catch { /* superseded pending runtime closes itself */ }
    }
  }

  /** Clear one-shot resume retry markers when the host intentionally starts a brand-new agent thread. */
  async close(): Promise<void> {
    this.disposed = true
    this.started = false
    this.taskNotificationFlush.dispose()
    await this.teardownRuntime()
    this.resumeForceAttempted.clear()
    this.lastSpawnResumeId = null
    this.startOpts = null
    this.eventListeners.clear()
    this.providerSessionIdListeners.clear()
    this.permissionModeAppliedListeners.clear()
  }

  /**
   * Apply model selection: standard set_config_option when configId is known,
   * otherwise ACP session/set_model (Grok and similar).
   * Grok effort lives in lastModeConfig (configId null) — re-attach it on
   * set_model so pre-prompt model apply does not drop the user's effort pick.
   * Explicit `opts.reasoningEffort` (e.g. send turn) wins over lastModeConfig.
   */
  private async applyModel(
    runtime: AcpRuntime,
    model: string,
    opts?: { reasoningEffort?: string },
  ): Promise<void> {
    const epoch = this.runtimeEpoch
    const agentId = this.config.agentId ?? null
    if (this.modelConfigId) {
      const next = await runtime.setConfigOption(this.modelConfigId, model)
      const extracted = extractModelConfig(next) ?? runtime.getModelConfig()
      const fallback = extracted
        ? {
            models: extracted.models,
            selectedModelId: extracted.selectedModelId ?? model,
            configId: extracted.configId,
          }
        : null
      this.emitConfigFromOptions(next, agentId, epoch, fallback)
      return
    }
    const effort =
      !this.modeConfigId
        ? (opts?.reasoningEffort?.trim()
          || this.lastModeConfig?.selectedModeId?.trim()
          || undefined)
        : undefined
    await runtime.setModel(model, effort ? { reasoningEffort: effort } : undefined)
    if (effort && this.lastModeConfig) {
      this.lastModeConfig = { ...this.lastModeConfig, selectedModeId: effort }
    }
    const cfg: AcpModelConfig = runtime.getModelConfig() ?? {
      configId: null,
      models: [{ id: model, name: model, description: '' }],
      selectedModelId: model,
    }
    this.emitModels(
      {
        models: cfg.models,
        selectedModelId: model,
        configId: cfg.configId,
      },
      agentId,
      epoch,
    )
    this.persistConfigCache(null, { ...cfg, selectedModelId: model }, agentId)
  }

  async setModel(model: string): Promise<void> {
    if (!this.runtime) return
    try {
      await this.applyModel(this.runtime, model)
    } catch (err) {
      log.warn('[AcpBackend] setModel failed:', err)
    }
  }

  async setSessionMode(modeId: string): Promise<void> {
    if (!this.runtime) return
    const epoch = this.runtimeEpoch
    const agentId = this.config.agentId ?? null
    try {
      if (this.modeConfigId) {
        const next = await this.runtime.setConfigOption(this.modeConfigId, modeId)
        this.emitConfigFromOptions(next, agentId, epoch)
        const extracted = extractModeConfig(next)
        if (extracted && extracted.selectedModeId !== modeId) {
          this.emitModes(
            { ...extracted, selectedModeId: modeId },
            agentId,
            epoch,
          )
        }
        return
      }

      // Grok: category=mode options are reasoning effort — switch via set_model + _meta.
      const modelId =
        this.selectedModelId
        ?? this.runtime.getModelConfig()?.selectedModelId
        ?? null
      if (!modelId) {
        log.warn('[AcpBackend] setSessionMode: no model id for effort switch mode=%s', modeId)
        return
      }
      await this.runtime.setModel(modelId, { reasoningEffort: modeId })
      const modes =
        this.runtime.getModeConfig()
        ?? this.lastModeConfig
      if (modes && modes.modes.length > 0) {
        this.emitModes(
          { ...modes, selectedModeId: modeId, configId: null },
          agentId,
          epoch,
        )
      } else {
        this.emitModes(
          {
            configId: null,
            modes: [{ id: modeId, name: modeId, description: '' }],
            selectedModeId: modeId,
          },
          agentId,
          epoch,
        )
      }
    } catch (err) {
      log.warn('[AcpBackend] setSessionMode failed:', err)
    }
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this.startOpts) {
      this.startOpts = { ...this.startOpts, permissionMode: mode }
    }
    if (!this.runtime) {
      log.info('[AcpBackend] setPermissionMode deferred until runtime ready mode=%s', mode)
      return
    }
    try {
      await this.runtime.setPermissionMode(mode)
      log.info('[AcpBackend] setPermissionMode applied mode=%s agent=%s', mode, this.config.agentId ?? '')
    } catch (err) {
      log.warn('[AcpBackend] setPermissionMode failed mode=%s:', mode, err)
    }
  }

  /**
   * Grok auto/manual session recap. No-op without a live runtime (do not spawn
   * solely for recap — matches keeping TUI agent warm).
   * @returns true only when the `x.ai/recap` RPC was sent successfully.
   */
  async requestSessionRecap(auto: boolean): Promise<boolean> {
    const runtime = this.runtime
    if (!runtime) {
      log.debug('[AcpBackend] requestSessionRecap skipped — no runtime auto=%s', auto)
      return false
    }
    if (!runtime.isSessionRecapAvailable()) {
      log.debug('[AcpBackend] requestSessionRecap skipped — not advertised auto=%s', auto)
      return false
    }
    // Grok eligibility: idle, no pending interaction, established session.
    if (this.activePrompt || this.getPendingInteractions().length > 0) {
      log.debug('[AcpBackend] requestSessionRecap skipped — busy auto=%s', auto)
      return false
    }
    try {
      await runtime.requestRecap(auto)
      return true
    } catch (err) {
      log.warn('[AcpBackend] requestSessionRecap failed auto=%s:', auto, err)
      return false
    }
  }

  async setSandbox(_sandboxInfo: SandboxInfo): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
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
    pending.resolve(mapPermissionDecision(pending.options, allow, alwaysAllow, decision))
    return true
  }

  respondToQuestion(
    requestId: string,
    answers: Record<string, string>,
    annotations?: QuestionAnnotations,
  ): void {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return
    this.pendingQuestions.delete(requestId)
    pending.resolve({ kind: 'accepted', answers, annotations })
  }

  dismissQuestion(requestId: string): void {
    const pending = this.pendingQuestions.get(requestId)
    if (!pending) return
    this.pendingQuestions.delete(requestId)
    pending.resolve({ kind: 'cancelled' })
  }

  respondToPlanApproval(requestId: string, approved: boolean, feedback?: string): void {
    const pending = this.pendingPlanApprovals.get(requestId)
    if (!pending) {
      log.debug('[AcpBackend] respondToPlanApproval miss requestId=%s', requestId)
      return
    }
    this.pendingPlanApprovals.delete(requestId)
    if (approved) {
      pending.resolve({ kind: 'approved' })
    } else {
      pending.resolve({ kind: 'cancelled', feedback })
    }
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    if (!this.runtime) return null
    try {
      return await this.runtime.getContextUsage()
    } catch {
      return null
    }
  }

  /**
   * Account credits for the usage gauge. Deliberately does not spawn: a panel
   * open must never cold-start an agent process (matches requestSessionRecap).
   */
  async getRateLimits(): Promise<ProviderRateLimits | null> {
    if (!this.runtime) return null
    try {
      return await this.runtime.getRateLimits()
    } catch {
      return null
    }
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return []
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'ACP harness does not support rewind yet' }
  }

  async reconnectMcp(_serverName: string): Promise<void> {}

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {}

  async reloadMcpServers(): Promise<void> {}

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(clientMessageId: string): boolean {
    const idx = this.pendingQueued.findIndex((r) => r.clientMessageId === clientMessageId)
    if (idx === -1) return false
    this.pendingQueued.splice(idx, 1)
    return true
  }

  getPendingInteractions(): AgentEvent[] {
    return [
      ...Array.from(this.pendingPermissions.values()).map((p) => p.event),
      ...Array.from(this.pendingQuestions.values()).map((p) => p.event),
      ...Array.from(this.pendingPlanApprovals.values()).map((p) => p.event),
    ]
  }

  onEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(handler)
    return () => this.eventListeners.delete(handler)
  }

  onProviderSessionId(handler: (id: string) => void): () => void {
    this.providerSessionIdListeners.add(handler)
    return () => this.providerSessionIdListeners.delete(handler)
  }

  onPermissionModeApplied(handler: (mode: PermissionMode) => void): () => void {
    this.permissionModeAppliedListeners.add(handler)
    return () => this.permissionModeAppliedListeners.delete(handler)
  }

  private emit(event: AgentEvent): void {
    for (const cb of this.eventListeners) {
      try {
        cb(event)
      } catch (err) {
        log.warn('[AcpBackend] event listener error:', err)
      }
    }
  }
}
