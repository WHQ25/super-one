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
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import log from '../../logger'
import {
  recordGrokFromUsage,
  subtractDelta,
  type UsageStepDelta,
} from '../../usage-stats-service'
import { resolveComputerUseGrant, rejectComputerUseGrant } from '../../computer-use/grant-request'
import {
  asGrokReasoningEffort,
  extractModeConfig,
  extractModelConfig,
  extractModelsFromAgentModelsField,
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
import { describeAcpRequestFailure } from '../../acp/acp-request-error'
import { notifySessionRecapReceived } from '../../acp/acp-recap-focus'
import { mapPermissionDecision, mapPermissionRequest, type PendingPermissionOptions } from '../../acp/acp-permission-map'
import { decideAcpPermission } from '../../acp/acp-permission-preapprove'
import { grantParentMainThreadCall } from '../../mcp/main-thread-session-guard'
import {
  buildAskUserQuestionRequest,
  buildMcpElicitPermissionRequest,
  buildPlanApprovalRequest,
  consentGateToAskUserQuestion,
  formatGrokAskUserResponse,
  formatGrokExitPlanModeResponse,
  formatGrokMcpElicitResponse,
  formatGrokScheduledTaskPrompt,
  type GrokAskUserAnswer,
  type GrokAskUserQuestionParams,
  type GrokConsentGate,
  type GrokExitPlanModeAnswer,
  type GrokExitPlanModeParams,
  type GrokMcpElicitAnswer,
  type GrokMcpElicitComplete,
  type GrokMcpElicitParams,
  type GrokScheduledTaskInject,
} from '../../acp/acp-xai-extensions'
import {
  TaskNotificationFlush,
  TaskNotificationQueue,
  taskNotificationRequest,
} from '../task-notification-queue'
import { QueuedUserMessageQueue } from '../queued-user-message-queue'
import type { BackendCommand, BackendStartOptions, HarnessId, SessionBackend, TaskNotificationInjectResult } from '../types'
import {
  isGrokGoalSlash,
  parseGrokCompactSlash,
  rewindPreviewFromPoints,
  rewindResultFromExecute,
  type GrokRewindMode,
} from '../../acp/acp-xai-session-ops'
import {
  parseGrokMcpInitProgress,
  parseGrokMcpServerStatus,
  parseGrokMcpServersUpdated,
  upsertMcpServer,
} from '../../acp/acp-xai-mcp-status'
import { buildAcpSessionMcpServers } from '../../acp/acp-mcp'

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

function sameDirSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...new Set(a ?? [])].sort()
  const right = [...new Set(b ?? [])].sort()
  return left.length === right.length && left.every((dir, i) => dir === right[i])
}

const ACP_BACKGROUND_IDLE_TASK_TYPES = new Set(['goal'])

function strField(o: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const a = o[camel]
  if (typeof a === 'string' && a.trim()) return a.trim()
  const b = o[snake]
  if (typeof b === 'string' && b.trim()) return b.trim()
  return undefined
}

/** run_id / subagent_id from a Grok launch tool_result — fills the gap before ExtNotification. */
function liveTaskIdsFromToolResultSummary(summary: string | undefined): string[] {
  if (!summary) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(summary)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const o = parsed as Record<string, unknown>
  if (o.validate_only === true || o.validateOnly === true) return []
  const ids: string[] = []
  const runId = strField(o, 'run_id', 'runId')
  if (runId) ids.push(runId)
  const subagentId = strField(o, 'subagent_id', 'subagentId')
  if (subagentId && subagentId !== runId) ids.push(subagentId)
  return ids
}

export class AcpBackend implements SessionBackend {
  readonly kind: HarnessId = 'acp'

  hasActiveRuntime(): boolean {
    return Boolean(this.runtime || this.ensureRuntimePromise)
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {
    if (this.activePrompt || this.pendingQueued.size > 0) return
    if (this.getPendingInteractions().length > 0) return
    if (this.hasActiveBackgroundTasks()) return
    await this.teardownRuntime()
  }

  /**
   * Grok workflows / subagents / monitors / scheduled loops keep `grok agent
   * stdio` alive. Without this, SessionManager's idle reaper session/load's the
   * actor and Grok marks the workflow `interrupted`.
   */
  hasActiveBackgroundTasks(): boolean {
    return this.liveBackgroundTaskIds.size > 0 || this.cronTaskIds.size > 0
  }

  private started = false
  private disposed = false
  private startOpts: BackendStartOptions | null = null
  private config: AcpBackendConfig = {}
  private runtime: AcpRuntime | null = null
  private activePrompt: Promise<void> | null = null
  /** Fallback when `x.ai/interject` is unavailable — extra turn after the live one. */
  private readonly pendingQueued = new QueuedUserMessageQueue({
    isBusy: () => this.isTurnBusy(),
    isAlive: () => this.started && !this.disposed,
    emit: (event) => this.emit(event),
    send: (request) => this.send(request),
    warn: (message, err) => log.warn(`[AcpBackend] ${message}:`, err),
  })
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
  /** Assistant bubble the live `session/prompt` is currently streaming into. */
  private liveAssistantId: string | null = null
  /** Ids minted for this prompt (primary + sealed/folded segments). */
  private readonly promptMessageIds = new Set<string>()
  /** After steer-insert, extra runtime `message_start`s fold into the live segment. */
  private interjectSplit = false

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

  private pendingElicitations = new Map<string, {
    resolve: (answer: GrokMcpElicitAnswer) => void
    event: AgentEvent
    elicitationId?: string
  }>()

  /** Skip duplicate `x.ai/scheduled_task_inject_prompt` while that task is queued or running. */
  private cronTaskIds = new Set<string>()
  /** Live Grok background work (workflow / subagent / monitor / scheduled / bash). */
  private liveBackgroundTaskIds = new Set<string>()
  /** Client-minted ids so the `x.ai/session/interjection` echo is not painted twice. */
  private readonly selfInterjectionIds = new Set<string>()
  /** True while a host `/compact` RPC is in flight (Grok may also emit auto_compact_*). */
  private compactingManual = false
  private mcpServers: McpServerInfo[] = []
  private mcpInit: { connected: number; total: number } | null = null

  private modelConfigId: string | null = null
  private modeConfigId: string | null = null
  /** Last known selected model (needed for Grok set_model / effort without configId). */
  private selectedModelId: string | null = null
  /** Last Grok effort pick from setSessionMode. Survives spawn before runtime exists. */
  private grokReasoningEffort: string | null = null
  /**
   * Last Grok `message_usage` totals recorded into usage_daily per assistant
   * message. Mid-turn events are cumulative (response_started/completed +
   * turn_completed); only the delta must be upserted or stats inflate.
   */
  private lastGrokUsageRecorded: { messageId: string; usage: UsageStepDelta } | null = null
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
    // ACP fixes its roots at `session/new`, so a changed directory set only
    // takes effect across a restart — same reasoning as cwd above.
    if (this.startOpts && !sameDirSet(this.startOpts.additionalDirectories, opts.additionalDirectories)) {
      return true
    }
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
        // The pipeline (fsRoots → session/new additionalDirectories, gated on
        // the agent's own capability) has always existed here; nothing ever
        // supplied it, so BackendStartOptions.additionalDirectories was dropped.
        additionalRoots: this.startOpts?.additionalDirectories,
        permissionMode: this.startOpts?.permissionMode,
        reasoningEffort:
          asGrokReasoningEffort(this.grokReasoningEffort)
          ?? asGrokReasoningEffort(
            typeof this.startOpts?.effort === 'string' ? this.startOpts.effort : null,
          ),
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
        consentNotice: {
          request: (gate) => this.handleConsentNotice(gate),
        },
        mcpElicit: {
          request: (params) => this.handleMcpElicit(params),
          complete: (payload) => this.handleMcpElicitComplete(payload),
        },
        scheduledTaskInject: {
          request: (payload) => this.handleScheduledTaskInject(payload),
        },
        onSessionInterjection: (payload) => this.handleSessionInterjection(payload),
        onMcpExt: (method, params) => this.handleMcpExt(method, params),
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
      // Billing rides this connection. Ask now so the sidebar gauge is filled
      // before the first turn ends — the renderer often fetches during prewarm.
      if (agentId && isGrokAcpAgent(agentId)) void this.prefetchRateLimits(agentId)
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
    if (event.type === 'compact_boundary' || (event.type === 'status_indicator' && event.compactResult)) {
      this.compactingManual = false
    }
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
          // Persist agent-global commands (including empty). Project-scoped
          // workflows are stripped inside the cache writer — they belong to
          // this session's cwd, not every grok-build session.
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
      const curr: UsageStepDelta = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens ?? 0,
        cacheCreationTokens: 0,
      }
      const prev = this.lastGrokUsageRecorded?.messageId === event.messageId
        ? this.lastGrokUsageRecorded.usage
        : { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
      const delta = subtractDelta(curr, prev)
      this.lastGrokUsageRecorded = { messageId: event.messageId, usage: curr }
      try {
        recordGrokFromUsage(
          {
            inputTokens: delta.inputTokens,
            outputTokens: delta.outputTokens,
            cacheReadTokens: delta.cacheReadTokens,
          },
          model,
          new Date(),
        )
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
    const mainSessionId = this.runtime?.sessionId ?? null
    const decision = decideAcpPermission(params, mainSessionId)
    if (decision.kind === 'deny') {
      log.info(
        '[AcpBackend] deny permission tool=%s reason=%s callerSession=%s mainSession=%s requestId=%s',
        decision.toolName,
        decision.reason,
        params.sessionId,
        mainSessionId,
        request.requestId,
      )
      return Promise.resolve(mapPermissionDecision(options, false))
    }
    if (decision.kind === 'auto-allow') {
      // Built-ins (except main-thread-only): prefer allow_always / allow-always-mcp
      // so Grok stops re-prompting. session_rename / session_tag stay allow-once
      // so a parent grant is not inherited by Grok child sessions.
      if (!decision.alwaysAllow && this.startOpts?.sessionId) {
        grantParentMainThreadCall(this.startOpts.sessionId)
      }
      log.info(
        '[AcpBackend] auto-allow permission tool=%s reason=%s always=%s requestId=%s',
        decision.toolName,
        decision.reason,
        decision.alwaysAllow,
        request.requestId,
      )
      return Promise.resolve(mapPermissionDecision(options, true, decision.alwaysAllow))
    }
    const event: AgentEvent = { type: 'permission_request', request }
    return new Promise((resolve) => {
      this.pendingPermissions.set(request.requestId, { resolve, options, event })
      this.emit(event)
    })
  }

  private handleConsentNotice(gate: GrokConsentGate): Promise<boolean> {
    const requestId = `acp_consent_${gate.id}_${gate.version}`
    const prev = this.pendingQuestions.get(requestId)
    if (prev) {
      this.pendingQuestions.delete(requestId)
      prev.resolve({ kind: 'cancelled' })
    }
    const request = consentGateToAskUserQuestion(gate, requestId)
    const event: AgentEvent = { type: 'ask_user_question', request }
    return new Promise((resolve) => {
      this.pendingQuestions.set(requestId, {
        resolve: (answer) => resolve(answer.kind === 'accepted'),
        event,
      })
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

  private handleMcpElicit(params: GrokMcpElicitParams): Promise<Record<string, unknown>> {
    const requestId =
      (typeof params.toolCallId === 'string' && params.toolCallId)
      || `acp_elicit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // Grok TUI replaces a prior elicitation card; cancel the old reverse-request.
    this.rejectPendingElicitations()
    const request = buildMcpElicitPermissionRequest(params, requestId)
    const event: AgentEvent = { type: 'permission_request', request }
    log.info(
      '[AcpBackend] mcp/elicit requestId=%s server=%s mode=%s',
      requestId,
      params.serverName,
      params.mode,
    )
    return new Promise((resolve) => {
      this.pendingElicitations.set(requestId, {
        resolve: (answer) => resolve(formatGrokMcpElicitResponse(answer)),
        event,
        elicitationId: params.elicitationId,
      })
      this.emit(event)
    })
  }

  private handleMcpElicitComplete(payload: GrokMcpElicitComplete): void {
    this.emit({
      type: 'elicitation_complete',
      mcpServerName: payload.serverName ?? '',
      elicitationId: payload.elicitationId,
    })
    for (const [id, pending] of this.pendingElicitations) {
      if (pending.elicitationId !== payload.elicitationId) continue
      this.pendingElicitations.delete(id)
      pending.resolve({ kind: 'cancel' })
      this.emit({
        type: 'interaction_resolved',
        interactionType: 'permission',
        requestId: id,
        approved: true,
      })
    }
  }

  private handleScheduledTaskInject(payload: GrokScheduledTaskInject): void {
    const prompt = payload.prompt.trim()
    if (!prompt) return
    if (this.cronTaskIds.has(payload.taskId)) {
      log.debug('[AcpBackend] skip duplicate cron inject task=%s', payload.taskId)
      return
    }
    this.cronTaskIds.add(payload.taskId)
    const framed = formatGrokScheduledTaskPrompt(prompt, payload.taskId, payload.humanSchedule)
    log.info(
      '[AcpBackend] scheduled_task_inject_prompt task=%s schedule=%s',
      payload.taskId,
      payload.humanSchedule,
    )
    void this.deliverCronPrompt(framed, payload.taskId)
  }

  /**
   * Idle → Session.send (status machine + user bubble). Busy → queue behind the
   * live turn. Never `backend.send()` from this notification — that races Session.
   */
  private async deliverCronPrompt(framed: string, taskId: string): Promise<void> {
    try {
      const outcome = await this.injectTaskNotification(framed)
      if (outcome === 'deferred') return
      await this.taskNotificationSender(framed)
    } catch (err) {
      log.warn('[AcpBackend] cron inject send failed task=%s:', taskId, err)
    } finally {
      this.cronTaskIds.delete(taskId)
    }
  }

  private rejectPendingElicitations(): void {
    for (const [, pending] of this.pendingElicitations) {
      pending.resolve({ kind: 'cancel' })
    }
    this.pendingElicitations.clear()
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
   * User-typed follow-ups park until steer (`x.ai/interject`); host wakes stay queued.
   */
  async injectTaskNotification(content: string): Promise<TaskNotificationInjectResult> {
    if (!this.started || this.disposed) return 'deferred'
    const text = content.trim()
    if (!text) return 'deferred'
    if (this.isTurnBusy()) {
      this.pendingTaskNotifications.enqueue(text)
      return 'deferred'
    }
    return 'unhandled'
  }

  /**
   * Set from the first synchronous line of `send()` until the turn settles, so
   * a queued message can never slip into the window between `send()` and the
   * `await ensureRuntime()` that assigns `activePrompt`.
   */
  private isTurnBusy(): boolean {
    return this.currentMessageId !== null || this.activePrompt !== null
  }

  /**
   * Cancel the live `session/prompt` and wait for it to settle. Used when a
   * `/goal …` line must be its own prompt — Grok's slash parser only looks at
   * the start of a new turn, and a concurrent prompt would otherwise park.
   */
  private async cancelLivePrompt(): Promise<void> {
    const inFlight = this.activePrompt
    this.interrupted = true
    try {
      await this.runtime?.cancel()
    } catch (err) {
      log.debug('[AcpBackend] cancel live prompt failed:', err)
    }
    if (inFlight) await inFlight.catch(() => {})
  }

  private emitMcpStatus(): void {
    this.emit({
      type: 'mcp_status',
      servers: [...this.mcpServers],
      init: this.mcpInit,
    })
  }

  private handleMcpExt(method: string, params: Record<string, unknown>): void {
    const bare = method.replace(/^_/, '')
    if (bare === 'x.ai/models/update') {
      const cfg = extractModelsFromAgentModelsField(params)
      if (cfg) this.emitModels(cfg, this.config.agentId ?? null, this.runtimeEpoch)
      return
    }
    if (bare === 'x.ai/mcp/init_progress') {
      this.mcpInit = parseGrokMcpInitProgress(params)
      this.emitMcpStatus()
      return
    }
    if (bare === 'x.ai/mcp_initialized') {
      this.mcpInit = null
      this.emitMcpStatus()
      return
    }
    if (bare === 'x.ai/mcp/servers_updated') {
      const list = parseGrokMcpServersUpdated(params)
      if (list) this.mcpServers = list
      this.emitMcpStatus()
      return
    }
    if (bare === 'x.ai/mcp/server_status') {
      const server = parseGrokMcpServerStatus(params)
      if (server) this.mcpServers = upsertMcpServer(this.mcpServers, server)
      this.emitMcpStatus()
    }
  }

  private handleSessionInterjection(payload: {
    sessionId?: string
    text: string
    interjectionId?: string
  }): void {
    if (payload.interjectionId && this.selfInterjectionIds.has(payload.interjectionId)) {
      this.selfInterjectionIds.delete(payload.interjectionId)
      return
    }
    const id = payload.interjectionId ?? `interject_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    this.emit({
      type: 'user_message_appended',
      message: {
        id,
        role: 'user',
        status: 'complete',
        content: [{ type: 'text', text: payload.text }],
        createdAt: new Date().toISOString(),
        providerId: 'local',
      },
    })
  }

  private async interjectRequest(request: SendMessageRequest): Promise<boolean> {
    const runtime = this.runtime
    if (!runtime?.interject) return false
    const id = request.clientMessageId ?? `interject_${Date.now().toString(36)}`
    this.selfInterjectionIds.add(id)
    try {
      await runtime.interject(request.content, id, request.images)
    } catch (err) {
      this.selfInterjectionIds.delete(id)
      log.warn('[AcpBackend] x.ai/interject failed — falling back to queue:', err)
      return false
    }
    this.splitLiveAssistantAfterInterject(request)
    return true
  }

  /**
   * Seal the current assistant, splice the steered user message, then open a
   * new assistant shell so later chunks land after the insert — not in the
   * next turn and not still growing the sealed bubble.
   */
  private splitLiveAssistantAfterInterject(request: SendMessageRequest): void {
    const sealedId = this.currentMessageId
    if (sealedId) {
      this.emit({
        type: 'message_complete',
        messageId: sealedId,
        metadata: { queuedTurnCount: 1 },
      })
    }
    if (request.clientMessageId) {
      this.emit({ type: 'queued_message_consumed', clientMessageId: request.clientMessageId })
    }
    if (!sealedId) return
    const nextId = request.assistantMessageId && request.assistantMessageId !== sealedId
      ? request.assistantMessageId
      : `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.promptMessageIds.add(sealedId)
    this.promptMessageIds.add(nextId)
    this.currentMessageId = nextId
    this.liveAssistantId = nextId
    this.interjectSplit = true
    if (this.lastGrokUsageRecorded?.messageId === sealedId) {
      this.lastGrokUsageRecorded = { ...this.lastGrokUsageRecorded, messageId: nextId }
    }
    this.emit({
      type: 'message_start',
      message: {
        id: nextId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    this.emit({ type: 'status_change', status: 'streaming' })
  }

  /** After steer, rewrite leftover runtime events onto the live assistant segment. */
  private retargetPromptEvent(event: AgentEvent): AgentEvent | null {
    const live = this.liveAssistantId
    if (!live) return event
    if (event.type === 'message_start') {
      if (!this.interjectSplit || event.message.id === live) return event
      this.promptMessageIds.add(event.message.id)
      return null
    }
    if (!('messageId' in event) || typeof event.messageId !== 'string') return event
    if (event.messageId === live || !this.promptMessageIds.has(event.messageId)) return event
    return { ...event, messageId: live }
  }

  private async compactNow(userContext?: string): Promise<void> {
    const runtime = await this.ensureRuntime()
    const usage = await runtime.getContextUsage().catch(() => null)
    this.compactingManual = true
    this.emit({ type: 'status_indicator', indicator: 'compacting' })
    try {
      await runtime.compactConversation(userContext)
      if (this.compactingManual) {
        this.emit({
          type: 'compact_boundary',
          trigger: 'manual',
          preTokens: usage?.totalTokens ?? 0,
        })
        this.emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
      }
    } catch (err) {
      this.emit({
        type: 'status_indicator',
        indicator: null,
        compactResult: 'failed',
        compactError: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.compactingManual = false
    }
  }

  private async rewindAtPromptIndex(
    index: number,
    mode: GrokRewindMode,
    dryRun: boolean,
  ): Promise<RewindFilesResult> {
    try {
      const runtime = await this.ensureRuntime()
      if (dryRun) {
        const points = await runtime.rewindPoints()
        return rewindPreviewFromPoints(points, index)
      }
      const result = await runtime.rewindExecute({ targetPromptIndex: index, mode, force: true })
      return rewindResultFromExecute(result)
    } catch (err) {
      return {
        canRewind: false,
        supportsCodeOnly: true,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private flushPendingTaskNotifications(): void {
    this.taskNotificationFlush.flush()
  }

  async send(request: SendMessageRequest): Promise<void> {
    if (!this.started || this.disposed) throw new Error('AcpBackend not started')
    const compact = parseGrokCompactSlash(request.content)
    if (compact) {
      await this.compactNow(compact.userContext)
      return
    }
    // `/goal …` has to be a new prompt so Grok's slash parser sees it. Parking
    // it for interject (or behind the live goal turn) leaves pause/clear as a
    // queued chip that never runs.
    if (isGrokGoalSlash(request.content) && this.isTurnBusy()) {
      await this.cancelLivePrompt()
    }
    if (this.pendingQueued.intercept(request)) return
    // Concurrent session/prompt cancels Grok's live turn. Park even `now`.
    if (this.isTurnBusy()) {
      const parked = this.pendingQueued.intercept({ ...request, priority: 'next' })
      if (parked) return
    }
    const messageId = request.assistantMessageId
      ?? `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.interrupted = false
    this.currentMessageId = messageId
    this.liveAssistantId = messageId
    this.promptMessageIds.clear()
    this.promptMessageIds.add(messageId)
    this.interjectSplit = false

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
    const checkpointId = request.clientMessageId
    if (checkpointId) {
      this.emit({ type: 'checkpoint_captured', messageId, checkpointId, resumePointId: checkpointId })
    }

    let emittedTerminal = false
    const onEvent = (event: AgentEvent) => {
      const routed = this.retargetPromptEvent(event)
      if (!routed) return
      if (
        routed.type === 'message_complete'
        || routed.type === 'message_interrupted'
        || routed.type === 'message_error'
      ) {
        emittedTerminal = true
      }
      this.routeSessionEvent(routed, this.config.agentId ?? null, this.runtimeEpoch)
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
      const failId = this.liveAssistantId ?? messageId
      if (this.interrupted) {
        if (!emittedTerminal) {
          this.emit({ type: 'message_interrupted', messageId: failId })
          this.emit({ type: 'status_change', status: 'idle' })
        }
        return
      }
      if (!emittedTerminal) {
        const errorInfo = describeAcpRequestFailure(err)
        this.emit({ type: 'message_error', messageId: failId, error: errorInfo.raw, errorInfo })
        this.emit({ type: 'status_change', status: 'error' })
      }
    } finally {
      this.activePrompt = null
      this.currentMessageId = null
      this.liveAssistantId = null
      this.promptMessageIds.clear()
      this.interjectSplit = false
      // User-typed messages outrank host task notifications; the notification
      // flush re-queues itself while the queued turn holds the runtime.
      this.pendingQueued.flush()
      this.flushPendingTaskNotifications()
    }
  }

  async interrupt(): Promise<void> {
    this.interrupted = true
    this.pendingQueued.clear()
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this.pendingPermissions.delete(id)
    }
    this.rejectPendingQuestions()
    this.rejectPendingPlanApprovals('abandoned')
    this.rejectPendingElicitations()
    this.cronTaskIds.clear()
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
    this.rejectPendingElicitations()
    this.cronTaskIds.clear()
    this.liveBackgroundTaskIds.clear()
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
    const effort = asGrokReasoningEffort(modeId)
    if (effort) this.grokReasoningEffort = effort
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
    formAnswers?: Record<string, unknown>,
  ): boolean {
    if (decision === 'cancel') {
      if (rejectComputerUseGrant(requestId, 'User cancelled')) return true
    }
    if (resolveComputerUseGrant(requestId, allow, alwaysAllow)) return true
    const elicit = this.pendingElicitations.get(requestId)
    if (elicit) {
      this.pendingElicitations.delete(requestId)
      if (decision === 'cancel') elicit.resolve({ kind: 'cancel' })
      else if (allow) elicit.resolve({ kind: 'accept', content: formAnswers })
      else elicit.resolve({ kind: 'decline' })
      return true
    }
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
      // Occupancy only — `x.ai/session/usage` is a cumulative billed ledger
      // (every model call's prompt+completion). Mixing it into totalTokens made
      // the context ring jump after idle. Live `_meta.totalTokens` is the
      // current window fill (same number Grok CLI `/context` uses).
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
    // A read that lands mid-spawn — a turn just started, or a prewarm the read
    // itself triggered — waits for the runtime instead of reporting nothing.
    if (!this.runtime && this.ensureRuntimePromise) await this.ensureRuntimePromise.catch(() => null)
    if (!this.runtime || typeof this.runtime.getRateLimits !== 'function') {
      log.info('[AcpBackend] getRateLimits skipped — no runtime')
      return null
    }
    try {
      return await this.runtime.getRateLimits()
    } catch {
      return null
    }
  }

  private async prefetchRateLimits(agentId: string): Promise<void> {
    if (!this.runtime || typeof this.runtime.getRateLimits !== 'function') return
    try {
      const { cacheAcpRateLimits } = await import('../../acp/acp-usage-service')
      const limits = await this.runtime.getRateLimits()
      if (limits) cacheAcpRateLimits(agentId, limits)
    } catch (err) {
      log.debug('[AcpBackend] prefetch rate limits failed agent=%s:', agentId, err)
    }
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    return [...this.mcpServers]
  }

  async rewindFiles(userMessageId: string, opts?: { dryRun?: boolean; includeConversation?: boolean }): Promise<RewindFilesResult> {
    const index = Number.parseInt(userMessageId, 10)
    if (!Number.isFinite(index) || index < 0) {
      return { canRewind: false, error: 'Grok prompt boundary not found' }
    }
    const mode: GrokRewindMode = opts?.includeConversation ? 'all' : 'files_only'
    return this.rewindAtPromptIndex(index, mode, opts?.dryRun === true)
  }

  async rewindConversation(beforeTurnId: string): Promise<RewindFilesResult> {
    const index = Number.parseInt(beforeTurnId, 10)
    if (!Number.isFinite(index) || index < 0) {
      return { canRewind: false, error: 'Grok prompt boundary not found' }
    }
    return this.rewindAtPromptIndex(index, 'conversation_only', false)
  }

  async handleCommand(cmd: BackendCommand): Promise<void> {
    if (cmd.kind !== 'acp.steer_queued') return
    if (!this.isTurnBusy()) throw new Error('Queued message can only steer an active ACP turn')
    const taken = this.pendingQueued.take(cmd.clientMessageId)
    if (!taken) throw new Error(`Queued ACP message not found: ${cmd.clientMessageId}`)
    try {
      const ok = await this.interjectRequest(taken.request)
      if (!ok) throw new Error('Grok interject is unavailable')
    } catch (err) {
      this.pendingQueued.restore(taken)
      throw err
    }
  }

  async reconnectMcp(_serverName: string): Promise<void> {}

  async toggleMcpServer(_serverName: string, _enabled: boolean): Promise<void> {}

  async reloadMcpServers(): Promise<void> {
    const runtime = this.runtime
    if (!runtime?.updateMcpServers || !this.startOpts) return
    const servers = buildAcpSessionMcpServers({
      cwd: this.effectiveCwd(this.startOpts),
      superoneSessionId: this.startOpts.sessionId,
    })
    await runtime.updateMcpServers(servers)
  }

  async reloadPlugins(): Promise<boolean> {
    return false
  }

  dequeueMessage(clientMessageId: string): boolean {
    return this.pendingQueued.dequeue(clientMessageId)
  }

  getPendingInteractions(): AgentEvent[] {
    return [
      ...Array.from(this.pendingPermissions.values()).map((p) => p.event),
      ...Array.from(this.pendingElicitations.values()).map((p) => p.event),
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
    this.noteBackgroundTaskLifecycle(event)
    for (const cb of this.eventListeners) {
      try {
        cb(event)
      } catch (err) {
        log.warn('[AcpBackend] event listener error:', err)
      }
    }
  }

  private noteBackgroundTaskLifecycle(event: AgentEvent): void {
    if (event.type === 'task_started') {
      if (event.taskType && ACP_BACKGROUND_IDLE_TASK_TYPES.has(event.taskType)) return
      if (event.taskId) this.liveBackgroundTaskIds.add(event.taskId)
      return
    }
    if (event.type === 'task_progress') {
      if (event.taskId) this.liveBackgroundTaskIds.add(event.taskId)
      return
    }
    if (event.type === 'task_notification') {
      const status = event.taskStatus
      if (status === 'completed' || status === 'stopped' || status === 'failed') {
        if (event.taskId) this.liveBackgroundTaskIds.delete(event.taskId)
      }
      return
    }
    if (event.type === 'content_delta' && event.delta.type === 'tool_result') {
      for (const id of liveTaskIdsFromToolResultSummary(event.delta.summary)) {
        this.liveBackgroundTaskIds.add(id)
      }
    }
  }
}
