import type {
  AgentEvent,
  AskUserQuestionRequest,
  CodexCompactRequest,
  CodexGoal,
  CodexGoalStatus,
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
  RealtimeTimelineResult,
  RealtimeVoiceStartRequest,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import { readCodexErrorOverrides } from '@superone/codex'
import log from '../../logger'
import { trace } from '../../agent/event-trace'
import { recordCodexFromTurnUsage, recordCodexFromUsage } from '../../usage-stats-service'
import type { CodexSession } from '../../codex/codex-session'
import {
  createCodexSession,
  tearDownForkRuntime,
} from '../../codex/codex-session'
import type { AppServerConnectionHandle, CodexProjectAuth } from '../../codex/app-server-connection'
import {
  buildCodexQueuedInput,
  compactCodexTurn,
  deriveFinalResponse,
  dismissCodexQuestion,
  interruptCodex,
  prewarmCodexConnection,
  prewarmCodexSession,
  resetCodexSession,
  respondToCodexPermission,
  respondToCodexQuestion,
  reviewCodexTurn,
  runCodexTurn,
  startCodexQueuedTurn,
  steerCodex,
  type CodexRunStreamCallbacks,
} from '../../codex/codex-turn'
import { CodexTurnUsageAccumulator } from '../../codex/codex-usage-accumulator'
import { CodexGoalController } from '../../codex/codex-goal-controller'
import {
  listCodexRealtimeTimeline,
  startCodexRealtime,
  type CodexRealtimeHandle,
} from '../../codex/codex-realtime'
import {
  TaskNotificationFlush,
  TaskNotificationQueue,
  taskNotificationRequest,
} from '../task-notification-queue'
import type { BackendCommand, BackendStartOptions, HarnessId, SessionBackend, TaskNotificationInjectResult } from '../types'

export interface CodexRunStreamCallbacksDeps {
  onThreadStarted?: (threadId: string) => void
  onItemDelta?: (phase: 'started' | 'updated' | 'completed', item: CodexThreadItem) => void
  onUsageDelta?: (usage: CodexUsageInfo) => void
  onUsageAccounted?: (threadId: string, usage: CodexUsageInfo) => void
  onCompactionStarted?: (trigger: 'manual' | 'auto') => void
  onCompactionCompleted?: (info: { trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number; durationMs?: number }) => void
  onCompactionFailed?: (error: string) => void
  onPermissionRequest?: (request: PermissionRequest) => void
  onAskUserQuestion?: (request: AskUserQuestionRequest) => void
  onQueuedMessageConsumed?: (clientMessageId: string) => void
  hasQueuedMessages?: () => boolean
  onTurnCompleted?: (info: { turnId?: string }) => void
  onTurnFailed?: (error: Error, turnId?: string) => void
}

export interface CodexServiceDeps {
  getProjectAuth(projectPath: string): CodexProjectAuth
  onAuthChanged(projectPath: string, cb: () => void): () => void
  prewarmAppServerConnection?(projectPath: string): void
  takeAppServerConnection?(projectPath: string, auth: CodexProjectAuth, apiProviderId?: string | null): Promise<AppServerConnectionHandle | null>
}

interface CodexBackendConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  extraEnv?: Record<string, string>
  permissionPreset?: CodexPermissionPreset
  reasoningEffort?: CodexReasoningEffort
}

interface WarmCodexHandle {
  handle: AppServerConnectionHandle
  auth: CodexProjectAuth
  threadId: string | null
  threadReady: boolean
  effectiveCwd: string
  model?: string
  reasoningEffort?: CodexReasoningEffort
  permissionPreset?: CodexPermissionPreset
}

interface DurableQueuedMessage {
  submissionId: string | null
  request: SendMessageRequest
  input: Array<Record<string, unknown>>
}

function mapPermissionMode(mode: PermissionMode | undefined): CodexPermissionPreset {
  if (mode === 'auto') return 'auto-review'
  if (mode === 'bypassPermissions' || mode === 'acceptEdits') return 'full-access'
  return 'default'
}

function mapEffort(effort: EffortLevel | undefined): CodexReasoningEffort | undefined {
  if (!effort) return undefined
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

function authsEqual(a: CodexProjectAuth, b: CodexProjectAuth): boolean {
  return a.mode === b.mode && (a.apiKey ?? '') === (b.apiKey ?? '')
}

let codexServiceFactory: (() => CodexServiceDeps) | null = null
export function setCodexServiceFactory(factory: (() => CodexServiceDeps) | null): void {
  codexServiceFactory = factory
}

function mapCodexMcpServerStatus(raw: unknown): McpServerInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as { name?: unknown; serverInfo?: unknown; tools?: unknown; resources?: unknown; authStatus?: unknown; pluginId?: unknown }
  const name = typeof entry.name === 'string' ? entry.name : ''
  if (!name) return null
  // Codex authStatus: 'unsupported' (no auth concept — the normal state for plain
  // stdio servers) | 'notLoggedIn' (OAuth supported but no token yet) | 'bearerToken'
  // (authenticated) | 'oAuth' (logged in with valid tokens). Only 'notLoggedIn'
  // genuinely needs the user to authenticate — surface it even when serverInfo is
  // present, since serverInfo and authStatus are independent server-side lookups.
  // Otherwise a populated serverInfo means the handshake completed (connected); a
  // null one means the server isn't up (failed — the snapshot can't tell starting
  // from failed, and 'oAuth'/'bearerToken'/'unsupported' here are NOT needs-auth).
  const status: McpServerInfo['status'] = entry.authStatus === 'notLoggedIn'
    ? 'needs-auth'
    : entry.serverInfo != null
      ? 'connected'
      : 'failed'
  const toolsRecord = entry.tools && typeof entry.tools === 'object'
    ? Object.values(entry.tools as Record<string, { name?: unknown; description?: unknown }>)
    : []
  const tools = toolsRecord
    .filter((t): t is { name?: unknown; description?: unknown } => t != null && typeof t === 'object')
    .map((t) => ({
      name: typeof t.name === 'string' ? t.name : '',
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
    }))
    .filter((t) => t.name)
  const resourcesValue = entry.resources
  const resourcesRecord = Array.isArray(resourcesValue)
    ? resourcesValue
    : resourcesValue && typeof resourcesValue === 'object'
      ? Object.values(resourcesValue as Record<string, { uri?: unknown; name?: unknown; description?: unknown; mimeType?: unknown }>)
      : []
  const resources = resourcesRecord
    .filter((resource): resource is { uri?: unknown; name?: unknown; description?: unknown; mimeType?: unknown } => resource != null && typeof resource === 'object')
    .map((resource) => ({
      uri: typeof resource.uri === 'string' ? resource.uri : '',
      ...(typeof resource.name === 'string' ? { name: resource.name } : {}),
      ...(typeof resource.description === 'string' ? { description: resource.description } : {}),
      ...(typeof resource.mimeType === 'string' ? { mimeType: resource.mimeType } : {}),
    }))
    .filter((resource) => resource.uri)
  return {
    name,
    ...(typeof entry.pluginId === 'string' && entry.pluginId ? { pluginId: entry.pluginId } : {}),
    status,
    toolCount: tools.length,
    tools,
    ...(resources.length > 0 ? { resources } : {}),
    authStatus: entry.authStatus === 'notLoggedIn' ? 'needs-auth' : entry.authStatus === 'bearerToken' || entry.authStatus === 'oAuth' ? 'authenticated' : 'unknown',
    fetchedAt: Date.now(),
  }
}

export class CodexBackend implements SessionBackend {
  readonly kind: HarnessId = 'codex'

  private readonly service: CodexServiceDeps
  private readonly goalController: CodexGoalController

  private started = false
  private disposed = false
  private providerSessionId: string | null = null
  private startOpts: BackendStartOptions | null = null
  private currentMessageId: string | null = null
  private activeRun: Promise<void> | null = null
  private swapRunAssistantId: ((nextId: string) => void) | null = null
  private readonly pendingTaskNotifications = new TaskNotificationQueue()
  /** Overridden by Session.bindTaskNotificationSend → Session.send / _sendChain. */
  private taskNotificationSender: (content: string) => Promise<void> = (content) =>
    this.send(taskNotificationRequest(content))
  private readonly taskNotificationFlush = new TaskNotificationFlush(
    this.pendingTaskNotifications,
    {
      isBusy: () => this.isTurnBusy(),
      isAlive: () => this.started && !this.disposed,
      send: (content) => this.taskNotificationSender(content),
    },
    {
      logLabel: 'CodexBackend',
      warn: (message) => log.warn(message),
    },
  )

  // Per-bubble item segmentation. A single Codex turn can be split into
  // multiple assistant bubbles via steer; each item belongs to the bubble
  // that was active when it first appeared, so late deltas (e.g. the
  // turn-end force-complete of a pre-steer item) never leak into the
  // steered bubble.
  private itemOwner = new Map<string, string>()
  private forkOwners = new Map<string, string>()
  private segments = new Map<string, { order: string[]; map: Map<string, CodexThreadItem> }>()
  private finalizedSegments = new Set<string>()
  private lastUsageSnapshot: CodexUsageInfo | null = null
  private turnUsage = new CodexTurnUsageAccumulator()
  private turnUsageRecorded = false
  private readonly durableQueue = new Map<string, DurableQueuedMessage>()
  private queueSteerInFlight = 0
  private queueRefreshPromise: Promise<void> | null = null
  private queueRefreshRequested = false

  private session: CodexSession | null = null
  private realtimeHandle: CodexRealtimeHandle | null = null
  private authChangedUnsub: (() => void) | null = null

  private warmHandlePromise: Promise<WarmCodexHandle | null> | null = null

  private eventListeners = new Set<(e: AgentEvent) => void>()
  private providerSessionIdListeners = new Set<(id: string) => void>()


  hasActiveRuntime(): boolean {
    return Boolean(this.session?.connectionHandle || this.warmHandlePromise)
  }

  constructor(service?: CodexServiceDeps) {
    const resolved = service ?? (codexServiceFactory ? codexServiceFactory() : null)
    if (!resolved) {
      throw new Error('CodexBackend: no CodexServiceDeps provided and factory not registered')
    }
    this.service = resolved
    this.goalController = new CodexGoalController({
      getSession: () => this.session,
      getAuth: () => {
        const projectPath = this.startOpts?.projectPath
        if (!projectPath) throw new Error('CodexBackend missing startOpts')
        return this.service.getProjectAuth(projectPath)
      },
      getCwd: () => this.startOpts?.cwd || this.startOpts?.projectPath || '',
      getCurrentRun: () => this.activeRun,
      getCallbacks: () => this.buildCallbacks(),
      onRunStart: (messageId) => {
        this.resetSegments(messageId)
        this.currentMessageId = messageId
        this.emit({
          type: 'message_start',
          message: {
            id: messageId,
            role: 'assistant',
            status: 'streaming',
            content: [],
            createdAt: new Date().toISOString(),
            providerId: 'codex',
          },
        })
        this.emit({ type: 'status_change', status: 'streaming' })
      },
      onRunComplete: (messageId, result, startedAt) => {
        const turnUsage = this.completedTurnUsage(result.turnUsage)
        this.recordTurnUsageStats(turnUsage, result.usage, this.session?.model)
        this.finalizeMessage(messageId, {
          finalResponseFallback: result.finalResponse,
          threadId: result.threadId,
          turnId: result.turnId,
          usage: result.usage,
          turnUsage,
          model: this.session?.model,
          startedAt,
        })
      },
      onRunError: (messageId, error) => {
        this.recordTurnUsageStats(this.completedTurnUsage(undefined), null, this.session?.model)
        const isInterrupt = /interrupt|abort/i.test(error.message)
        this.emit(isInterrupt
          ? { type: 'message_interrupted', messageId }
          : { type: 'message_error', messageId, error: error.message, errorInfo: buildAgentErrorInfo(error.message) })
      },
      onIdle: () => {
        this.emit({ type: 'status_change', status: 'idle' })
        this.currentMessageId = null
        this.flushPendingTaskNotifications()
      },
    })
  }

  bindTaskNotificationSend(send: (content: string) => Promise<void>): void {
    this.taskNotificationSender = send
  }

  /**
   * Mid-turn wake only. Idle synthetic turns are owned by Session.send.
   * Prefer mid-turn `turn/steer` when a run is live; otherwise queue until idle.
   */
  async injectTaskNotification(content: string): Promise<TaskNotificationInjectResult> {
    this.assertStarted()
    const text = content.trim()
    if (!text) return 'deferred'

    if (this.session?.steerFn) {
      await steerCodex(this.session, text)
      return 'sent-inline'
    }

    if (this.isTurnBusy()) {
      this.pendingTaskNotifications.enqueue(text)
      return 'deferred'
    }

    return 'unhandled'
  }

  private isTurnBusy(): boolean {
    return Boolean(
      this.activeRun
      || this.goalController.active
      || this.session?.runningController
      || this.session?.steerFn,
    )
  }

  private flushPendingTaskNotifications(): void {
    this.taskNotificationFlush.flush()
  }

  async start(opts: BackendStartOptions): Promise<void> {
    if (this.started) throw new Error('CodexBackend already started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
    this.startOpts = opts
    if (opts.providerSessionId) {
      this.providerSessionId = opts.providerSessionId
    }
    this.session = createCodexSession(
      opts.sessionId,
      opts.projectPath,
      undefined,
      opts.providerSessionId ?? undefined,
      undefined,
      undefined,
      opts.apiProviderId ?? null,
      opts.systemPromptAppend,
    )
    this.session.queueChangedFn = (threadId) => this.scheduleDurableQueueRefresh(threadId)
    await this.adoptWarmHandle()
    this.authChangedUnsub = this.service.onAuthChanged(opts.projectPath, () => {
      this.handleAuthChanged()
    })
    this.started = true
    if (opts.providerSessionId) await this.restoreDurableQueue()
  }

  prewarm(opts: BackendStartOptions): void {
    if (this.started || this.disposed) return
    if (this.warmHandlePromise) {
      return
    }
    const auth = this.service.getProjectAuth(opts.projectPath)
    const promise = this.prepareWarmHandle(opts, auth).catch((err) => {
      log.warn('[CodexBackend] prewarm failed: %s', err instanceof Error ? err.message : String(err))
      if (this.warmHandlePromise === promise) {
        this.warmHandlePromise = null
      }
      return null
    })
    this.warmHandlePromise = promise
  }

  private async discardWarmHandle(_reason: string): Promise<void> {
    const promise = this.warmHandlePromise
    if (!promise) return
    this.warmHandlePromise = null
    try {
      const warm = await promise
      if (warm) await warm.handle.close()
    } catch { /* ignore */ }
  }

  private resolveWarmSessionOptions(opts: BackendStartOptions): {
    model?: string
    reasoningEffort?: CodexReasoningEffort
    permissionPreset: CodexPermissionPreset
    cwd: string
  } {
    const config = readConfig(opts.config)
    return {
      model: opts.model ?? config.model,
      reasoningEffort: mapEffort(opts.effort) ?? config.reasoningEffort,
      permissionPreset: config.permissionPreset ?? mapPermissionMode(opts.permissionMode),
      cwd: opts.cwd || opts.projectPath,
    }
  }

  private async createWarmHandle(projectPath: string, auth: CodexProjectAuth, apiProviderId: string | null): Promise<AppServerConnectionHandle> {
    if (this.service.prewarmAppServerConnection) {
      this.service.prewarmAppServerConnection(projectPath)
    }
    const pooled = this.service.takeAppServerConnection
      ? await this.service.takeAppServerConnection(projectPath, auth, apiProviderId).catch(() => null)
      : null
    return pooled ?? prewarmCodexConnection(auth, undefined, apiProviderId)
  }

  private async prepareWarmHandle(opts: BackendStartOptions, auth: CodexProjectAuth): Promise<WarmCodexHandle | null> {
    const startedAt = Date.now()
    const warm = this.resolveWarmSessionOptions(opts)
    const handle = await this.createWarmHandle(opts.projectPath, auth, opts.apiProviderId ?? null)
    const warmSession = createCodexSession(
      opts.sessionId,
      opts.projectPath,
      warm.model,
      opts.providerSessionId ?? undefined,
      warm.reasoningEffort,
      warm.permissionPreset,
      opts.apiProviderId ?? null,
      opts.systemPromptAppend,
    )
    try {
      const threadId = await prewarmCodexSession(handle, warmSession, warm.cwd)
      log.info('[CodexBackend] prewarm ready project=%s thread=%s durMs=%d', opts.projectPath, threadId, Date.now() - startedAt)
      trace('codex.prewarm', 'ready', {
        projectPath: opts.projectPath,
        threadId,
        cwd: warm.cwd,
        model: warmSession.model,
        reasoningEffort: warm.reasoningEffort,
        permissionPreset: warm.permissionPreset,
        durMs: Date.now() - startedAt,
      }, opts.sessionId)
      return {
        handle,
        auth: { mode: auth.mode, apiKey: auth.apiKey },
        threadId,
        threadReady: true,
        effectiveCwd: warm.cwd,
        model: warmSession.model,
        reasoningEffort: warm.reasoningEffort,
        permissionPreset: warm.permissionPreset,
      }
    } catch (err) {
      try { await handle.close() } catch {}
      throw err
    }
  }

  private async adoptWarmHandle(): Promise<void> {
    if (!this.session) return
    const session = this.session
    const startOpts = this.startOpts
    if (!startOpts) return
    const currentAuth = this.service.getProjectAuth(startOpts.projectPath)
    let warm: WarmCodexHandle | null = null
    if (this.warmHandlePromise) {
      warm = await this.warmHandlePromise.catch(() => null)
    } else if (this.service.takeAppServerConnection) {
      const handle = await this.service.takeAppServerConnection(startOpts.projectPath, currentAuth, startOpts.apiProviderId ?? null).catch(() => null)
      if (handle) {
        warm = {
          handle,
          auth: { mode: currentAuth.mode, apiKey: currentAuth.apiKey },
          threadId: null,
          threadReady: false,
          effectiveCwd: startOpts.cwd || startOpts.projectPath,
        }
      }
    }
    this.warmHandlePromise = null
    if (!warm) return
    if (!authsEqual(warm.auth, currentAuth)) {
      try { await warm.handle.close() } catch { /* ignore */ }
      return
    }
    warm.handle.onClosed((info) => {
      if (session.connectionHandle === warm.handle) {
        tearDownForkRuntime(session, 'app-server exited')
        log.info('[codex] app-server exited code=%s signal=%s', info.code, info.signal)
      }
    })
    session.connectionHandle = warm.handle
    session.connectionAuth = { mode: currentAuth.mode, apiKey: currentAuth.apiKey }
    session.threadId = warm.threadId
    session.threadReady = warm.threadReady && Boolean(warm.threadId)
    session.effectiveCwd = warm.effectiveCwd
    if (warm.model !== undefined) session.model = warm.model
    if (warm.reasoningEffort !== undefined) session.modelReasoningEffort = warm.reasoningEffort
    if (warm.permissionPreset !== undefined) session.permissionPreset = warm.permissionPreset
    trace('codex.prewarm', 'adopted', {
      projectPath: startOpts.projectPath,
      threadId: warm.threadId,
      cwd: warm.effectiveCwd,
    }, startOpts.sessionId)
  }

  async releaseRuntime(_reason: 'idle'): Promise<void> {
    const session = this.session
    if (this.activeRun || this.goalController.active || session?.runningController) return
    if (session?.forkListeners && session.forkListeners.size > 0) return
    const handle = session?.connectionHandle ?? null
    await this.discardWarmHandle('idle')
    if (handle && session?.connectionHandle === handle && (
      this.activeRun || this.goalController.active || session.runningController
    )) return
    await this.closeRuntimeConnection('idle release', handle)
    trace('backend.lifecycle', 'runtime_released', { reason: 'idle', backend: 'codex' })
  }

  private async closeRuntimeConnection(
    reason: string,
    handle: AppServerConnectionHandle | null = this.session?.connectionHandle ?? null,
  ): Promise<void> {
    const session = this.session
    if (!handle) return
    if (session?.connectionHandle === handle) tearDownForkRuntime(session, reason)
    try {
      await handle.close()
    } catch (err) {
      log.warn('[CodexBackend] close connection during %s failed: %s', reason, err instanceof Error ? err.message : String(err))
    }
  }

  async rebuild(opts: BackendStartOptions): Promise<void> {
    if (!this.started) { await this.start(opts); return }
    this.startOpts = opts
    this.discardSessionConnection('rebuild')
  }

  async setAdditionalDirectories(dirs: string[]): Promise<boolean> {
    if (!this.startOpts) return false
    this.startOpts = {
      ...this.startOpts,
      additionalDirectories: dirs.length > 0 ? [...dirs] : undefined,
    }
    return true
  }

  private handleAuthChanged(): void {
    this.discardSessionConnection('auth-changed')
  }

  private discardSessionConnection(reason: string): void {
    const session = this.session
    if (!session) return
    if (session.runningController) {
      try { session.runningController.abort() } catch { /* ignore */ }
    }
    const handle = session.connectionHandle
    tearDownForkRuntime(session, `connection discarded: ${reason}`)
    if (handle) {
      void handle.close().catch((err) => {
        log.warn('[CodexBackend] close connection during %s failed: %s', reason, err instanceof Error ? err.message : String(err))
      })
    }
  }

  private ensureSessionForRequest(
    requestedModel?: string,
    requestedThreadId?: string,
    requestedReasoningEffort?: CodexReasoningEffort,
    requestedPermissionPreset?: CodexPermissionPreset,
    requestedServiceTier?: string | null,
  ): CodexSession {
    const startOpts = this.startOpts
    if (!startOpts) throw new Error('CodexBackend missing startOpts')
    const existing = this.session
    if (!existing) {
      const created = createCodexSession(
        startOpts.sessionId,
        startOpts.projectPath,
        requestedModel,
        requestedThreadId,
        requestedReasoningEffort,
        requestedPermissionPreset,
        startOpts.apiProviderId ?? null,
        startOpts.systemPromptAppend,
        requestedServiceTier,
      )
      this.session = created
      return created
    }

    if (requestedThreadId && requestedThreadId !== existing.threadId) {
      existing.threadId = requestedThreadId
      existing.threadReady = false
      existing.effectiveCwd = null
    }
    if (requestedModel !== undefined) existing.model = requestedModel
    if (requestedReasoningEffort !== undefined) existing.modelReasoningEffort = requestedReasoningEffort
    if (requestedPermissionPreset !== undefined) existing.permissionPreset = requestedPermissionPreset
    if (requestedServiceTier !== undefined) existing.serviceTier = requestedServiceTier
    existing.apiProviderId = startOpts.apiProviderId ?? null

    return existing
  }

  async send(request: SendMessageRequest): Promise<void> {
    this.assertStarted()
    if (this.realtimeHandle) throw new Error('Stop realtime voice before sending a text turn.')
    if ((request.priority === 'next' || request.priority === 'later') && this.isTurnBusy()) {
      await this.enqueueDurableMessage(request)
      return
    }
    const sessionThreadId = this.session?.threadId
    if (!this.goalController.goal && sessionThreadId) {
      try {
        await this.goalController.get(sessionThreadId)
      } catch (err) {
        log.warn('[CodexBackend] failed to refresh goal before explicit turn: %s', err instanceof Error ? err.message : String(err))
      }
    }
    if (this.goalController.active) throw new Error('Codex goal is active')
    const resumePausedGoal = this.goalController.goal?.status === 'paused'
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
    const resolvedServiceTier = request.codex?.serviceTier !== undefined
      ? request.codex.serviceTier
      : (this.session?.serviceTier ?? null)
    const resolvedThreadId = request.codex?.threadId ?? this.providerSessionId ?? undefined
    const resolvedCwd = request.codex?.cwd ?? startOpts.cwd

    const session = this.ensureSessionForRequest(
      resolvedModel,
      resolvedThreadId,
      resolvedReasoningEffort,
      resolvedPermissionPreset,
      resolvedServiceTier,
    )

    const auth = this.service.getProjectAuth(projectPath)

    this.resetSegments(assistantMessageId)
    this.currentMessageId = assistantMessageId
    let runningAssistantId = assistantMessageId
    const runStart = Date.now()
    const finalizeSegment = (
      messageId: string,
      opts: {
        finalResponseFallback?: string
        threadId: string | null
        turnId?: string
        usage: CodexUsageInfo | null
        turnUsage?: CodexRunResult['turnUsage']
      },
    ): void => {
      this.finalizeMessage(messageId, { ...opts, model: session.model ?? resolvedModel, startedAt: runStart })
    }
    this.swapRunAssistantId = (nextId: string) => {
      finalizeSegment(runningAssistantId, {
        threadId: this.providerSessionId,
        usage: this.lastUsageSnapshot,
      })
      runningAssistantId = nextId
      this.currentMessageId = nextId
      this.ensureSegment(nextId)
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
    const baseCallbacks = this.buildCallbacks()
    let compactLifecycleSettled = false
    const turnBoundaryCallbacks: CodexRunStreamCallbacks = {
      ...baseCallbacks,
      onTurnCompleted: ({ turnId }) => {
        finalizeSegment(runningAssistantId, {
          threadId: this.providerSessionId,
          turnId,
          usage: this.lastUsageSnapshot,
        })
      },
      onTurnFailed: (error) => {
        this.failMessage(runningAssistantId, error)
      },
    }
    const callbacks: CodexRunStreamCallbacks = mode === 'compact'
      ? {
          ...turnBoundaryCallbacks,
          onCompactionCompleted: (info) => {
            compactLifecycleSettled = true
            baseCallbacks.onCompactionCompleted?.(info)
          },
          onCompactionFailed: (error) => {
            compactLifecycleSettled = true
            baseCallbacks.onCompactionFailed?.(error)
          },
        }
      : turnBoundaryCallbacks

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
            serviceTier: resolvedServiceTier,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
            additionalDirectories: startOpts.additionalDirectories,
          }
          result = await reviewCodexTurn(session, auth, projectPath, reviewRequest, callbacks)
        } else if (mode === 'compact') {
          const compactRequest: CodexCompactRequest = {
            model: resolvedModel,
            permissionPreset: resolvedPermissionPreset,
            serviceTier: resolvedServiceTier,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
            additionalDirectories: startOpts.additionalDirectories,
          }
          callbacks.onCompactionStarted?.('manual')
          result = await compactCodexTurn(session, auth, projectPath, compactRequest, callbacks)
        } else {
          const codexRequest: CodexRunRequest = {
            prompt: request.codex?.prompt ?? request.content,
            images: request.images,
            model: resolvedModel,
            reasoningEffort: resolvedReasoningEffort,
            permissionPreset: resolvedPermissionPreset,
            serviceTier: resolvedServiceTier,
            collaborationMode: request.codex?.collaborationMode,
            threadId: resolvedThreadId,
            messageId: assistantMessageId,
            cwd: resolvedCwd,
            additionalDirectories: startOpts.additionalDirectories,
          }
          result = await runCodexTurn(session, auth, projectPath, codexRequest, callbacks)
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
        const turnUsage = this.completedTurnUsage(result.turnUsage)
        this.recordTurnUsageStats(turnUsage, result.usage, session.model ?? resolvedModel)
        finalizeSegment(runningAssistantId, {
          finalResponseFallback: finalText,
          threadId: result.threadId,
          turnId: result.turnId,
          usage: result.usage,
          turnUsage,
        })
        if (resumePausedGoal && result.threadId && this.goalController.goal?.status === 'paused') {
          try {
            await this.goalController.setStatus(result.threadId, 'active')
          } catch (err) {
            log.warn('[CodexBackend] failed to resume paused goal: %s', err instanceof Error ? err.message : String(err))
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.recordTurnUsageStats(this.completedTurnUsage(undefined), null, session.model ?? resolvedModel)
        const isInterrupt = /interrupt|abort/i.test(message)
        if (mode === 'compact' && !compactLifecycleSettled) {
          callbacks.onCompactionFailed?.(message)
        }
        if (isInterrupt) {
          this.emit({ type: 'message_interrupted', messageId: runningAssistantId })
        } else {
          this.emit({
            type: 'message_error',
            messageId: runningAssistantId,
            error: message,
            errorInfo: buildAgentErrorInfo(message, readCodexErrorOverrides(error)),
          })
        }
        throw error
      } finally {
        this.emit({ type: 'status_change', status: 'idle' })
        if (this.currentMessageId === runningAssistantId) this.currentMessageId = null
        this.swapRunAssistantId = null
      }
    })()

    this.activeRun = task.catch(() => undefined).finally(() => {
      this.activeRun = null
      this.flushPendingTaskNotifications()
    })
    await task
  }

  async interrupt(): Promise<void> {
    if (!this.started) return
    if (this.goalController.goal?.status === 'active' || this.goalController.active) {
      try {
        await this.goalController.pause()
      } catch (err) {
        log.warn('[CodexBackend] failed to pause goal before interrupt: %s', err instanceof Error ? err.message : String(err))
      }
    }
    this.interruptSession()
  }

  async startRealtimeVoice(request: RealtimeVoiceStartRequest): Promise<void> {
    this.assertStarted()
    if (this.realtimeHandle) throw new Error('Realtime voice is already active.')
    if (this.isTurnBusy()) throw new Error('Wait for the current Codex turn to finish before starting voice.')
    const session = this.session
    const startOpts = this.startOpts
    if (!session || !startOpts) throw new Error('Codex realtime session is unavailable.')
    const handle = await startCodexRealtime(
      session,
      this.service.getProjectAuth(startOpts.projectPath),
      startOpts.projectPath,
      startOpts.cwd || startOpts.projectPath,
      request,
      (event) => this.emit(event),
    )
    this.realtimeHandle = handle
    void handle.closed.finally(() => {
      if (this.realtimeHandle === handle) this.realtimeHandle = null
    })
  }

  async stopRealtimeVoice(): Promise<void> {
    const handle = this.realtimeHandle
    if (!handle) return
    await handle.stop()
  }

  async getRealtimeTimeline(): Promise<RealtimeTimelineResult> {
    this.assertStarted()
    const session = this.session
    const startOpts = this.startOpts
    if (!session || !startOpts) return { segments: [], activeRealtimeSessionId: null }
    return listCodexRealtimeTimeline(
      session,
      this.service.getProjectAuth(startOpts.projectPath),
      startOpts.projectPath,
      startOpts.cwd || startOpts.projectPath,
    )
  }

  async close(): Promise<void> {
    if (this.disposed) return
    this.goalController.stop()
    this.taskNotificationFlush.dispose()
    try { await this.realtimeHandle?.stop() } catch { /* connection teardown below is authoritative */ }
    this.realtimeHandle = null
    const session = this.session
    try {
      if (session && (session.runningController || this.activeRun)) resetCodexSession(session)
      else await this.closeRuntimeConnection('backend close')
    } catch { /* ignore */ }
    if (this.warmHandlePromise) {
      const warmPromise = this.warmHandlePromise
      this.warmHandlePromise = null
      try {
        const warm = await warmPromise
        if (warm) await warm.handle.close()
      } catch { /* ignore */ }
    }
    if (this.activeRun) { try { await this.activeRun } catch { /* ignore */ } }
    await this.goalController.wait()
    await this.closeRuntimeConnection('backend close')
    if (session) resetCodexSession(session)
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

  async setSessionMode(_modeId: string): Promise<void> {}

  async setModel(_model: string): Promise<void> {
    this.assertStarted()
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.assertStarted()
    if (this.startOpts) this.startOpts.permissionMode = mode
  }

  async setSandbox(): Promise<void> {}

  respondToPermission(
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    reason?: string,
    _selectedSuggestions?: number[],
    decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ): boolean {
    const session = this.session
    if (!session) return false
    return respondToCodexPermission(session, requestId, allow, alwaysAllow, reason, decision, formAnswers)
  }

  respondToQuestion(requestId: string, answers: Record<string, string>, _annotations?: QuestionAnnotations): void {
    const session = this.session
    if (!session) return
    respondToCodexQuestion(session, requestId, answers)
  }

  dismissQuestion(requestId: string): void {
    const session = this.session
    if (!session) return
    dismissCodexQuestion(session, requestId)
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
        if (cmd.newAssistantMessageId && !this.goalController.active) {
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
        await steerCodex(session, cmd.input)
        return
      }
      case 'codex.steer_queued': {
        await this.steerQueuedMessage(cmd.clientMessageId)
        return
      }
      case 'codex.plan_approval':
      case 'codex.collaboration_mode_change':
        return
    }
  }

  async getContextUsage(): Promise<ContextUsageInfo | null> {
    const usage = this.lastUsageSnapshot
    if (!usage) return null
    const promptTokens = Math.max(0, usage.lastInputTokens)
    const cachedTokens = Math.min(promptTokens, Math.max(0, usage.lastCachedInputTokens))
    const inputTokens = Math.max(0, promptTokens - cachedTokens)
    const maxTokens = Math.max(0, usage.contextWindow)
    return {
      categories: [
        ...(inputTokens > 0 ? [{ name: 'input', tokens: inputTokens, color: '#3b82f6' }] : []),
        ...(cachedTokens > 0 ? [{ name: 'cacheRead', tokens: cachedTokens, color: '#8b5cf6' }] : []),
      ],
      totalTokens: promptTokens,
      maxTokens,
      percentage: maxTokens > 0 ? Math.min(100, Math.round((promptTokens / maxTokens) * 1000) / 10) : 0,
      model: this.session?.model ?? '',
    }
  }

  hasActiveBackgroundTasks(): boolean {
    return this.goalController.active || this.realtimeHandle !== null
  }

  async getCodexGoal(threadId: string): Promise<CodexGoal | null> {
    this.assertStarted()
    return this.goalController.get(threadId)
  }

  async setCodexGoal(threadId: string, objective: string, status?: CodexGoalStatus): Promise<CodexGoal | null> {
    this.assertStarted()
    const goal = await this.goalController.set(threadId, objective, status)
    if (status === 'paused') this.interruptSession()
    return goal
  }

  async clearCodexGoal(threadId: string): Promise<boolean> {
    this.assertStarted()
    const cleared = await this.goalController.clear(threadId)
    if (cleared) this.interruptSession()
    return cleared
  }

  async getMcpServerStatus(): Promise<McpServerInfo[]> {
    const session = this.session
    const handle = session?.connectionHandle
    if (!session || !handle) return []
    try {
      const result = await handle.connection.request('mcpServerStatus/list', {
        threadId: session.threadId ?? undefined,
        detail: 'full',
      })
      const data = Array.isArray(result.data) ? result.data : []
      return data.map((raw) => mapCodexMcpServerStatus(raw)).filter((s): s is McpServerInfo => s !== null)
    } catch (err) {
      log.debug('[CodexBackend] getMcpServerStatus failed: %s', err instanceof Error ? err.message : String(err))
      return []
    }
  }

  async rewindFiles(_userMessageId: string, _opts?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    return { canRewind: false, error: 'rewindFiles not supported by Codex' }
  }

  async rewindConversation(beforeTurnId: string): Promise<RewindFilesResult> {
    this.assertStarted()
    if (this.isTurnBusy()) return { canRewind: false, error: 'Cannot rewind an active Codex turn' }
    const session = this.session
    const threadId = session?.threadId ?? this.providerSessionId
    if (!session || !threadId) return { canRewind: false, error: 'No Codex thread to rewind' }
    if (this.durableQueue.size > 0) {
      return { canRewind: false, error: 'Cannot rewind while Codex queued messages are pending' }
    }
    try {
      const connection = await this.ensureManagementConnection()
      try {
        await connection.request('thread/revert', { threadId, beforeTurnId })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/only supports paginated threads/i.test(message)) throw error
        const result = await connection.request('thread/fork', { threadId, beforeTurnId })
        const forkedThreadId = result.thread && typeof result.thread === 'object'
          ? (result.thread as { id?: unknown }).id
          : undefined
        if (typeof forkedThreadId !== 'string' || !forkedThreadId) {
          throw new Error('Codex returned no forked thread id')
        }
        session.threadId = forkedThreadId
        session.threadReady = true
        this.fireProviderSessionId(forkedThreadId)
      }
      this.lastUsageSnapshot = null
      return { canRewind: true, supportsCodeOnly: false }
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async ensureManagementConnection(): Promise<AppServerConnectionHandle['connection']> {
    const existing = this.session?.connectionHandle
    if (existing) return existing.connection
    const opts = this.startOpts
    if (!opts) throw new Error('CodexBackend missing startOpts')
    const auth = this.service.getProjectAuth(opts.projectPath)
    this.warmHandlePromise = this.prepareWarmHandle(opts, auth)
    await this.adoptWarmHandle()
    const handle = this.session?.connectionHandle
    if (!handle) throw new Error('Failed to restore Codex app-server connection')
    return handle.connection
  }

  async reloadMcpServers(): Promise<void> {
    const session = this.session
    const handle = session?.connectionHandle
    if (!handle) return
    // codex `config/mcpServer/reload` is global (reconnects every MCP server
    // process-wide, not thread-scoped), so firing it mid-turn can drop the server
    // backing an in-flight tool call. New tools only affect the NEXT turn (which
    // rebuilds and re-snapshots anyway), so skip the reload while a turn is running.
    if (session?.runningController) return
    try {
      await handle.connection.request('config/mcpServer/reload')
    } catch (err) {
      log.debug('[CodexBackend] reloadMcpServers failed: %s', err instanceof Error ? err.message : String(err))
    }
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

  async startQueuedMessages(): Promise<boolean> {
    this.assertStarted()
    if (this.isTurnBusy() || this.durableQueue.size === 0) return false
    const session = this.session
    const opts = this.startOpts
    if (!session || !opts) return false
    const startedAt = Date.now()
    let runningAssistantId: string | null = null
    const finalizeSegment = (
      messageId: string,
      result: Pick<CodexRunResult, 'threadId' | 'turnId' | 'usage' | 'turnUsage'>,
      finalResponseFallback?: string,
    ): void => {
      this.finalizeMessage(messageId, {
        ...(finalResponseFallback ? { finalResponseFallback } : {}),
        threadId: result.threadId,
        turnId: result.turnId,
        usage: result.usage,
        turnUsage: result.turnUsage,
        model: session.model,
        startedAt,
      })
    }
    this.swapRunAssistantId = (nextId: string) => {
      if (runningAssistantId) {
        finalizeSegment(runningAssistantId, {
          threadId: this.providerSessionId,
          usage: this.lastUsageSnapshot,
        })
      } else {
        this.resetSegments(nextId)
      }
      runningAssistantId = nextId
      this.currentMessageId = nextId
      this.ensureSegment(nextId)
    }
    const baseCallbacks = this.buildCallbacks()
    const callbacks: CodexRunStreamCallbacks = {
      ...baseCallbacks,
      onTurnCompleted: ({ turnId }) => {
        if (!runningAssistantId) return
        finalizeSegment(runningAssistantId, {
          threadId: this.providerSessionId,
          turnId,
          usage: this.lastUsageSnapshot,
        })
      },
      onTurnFailed: (error) => {
        if (runningAssistantId) this.failMessage(runningAssistantId, error)
      },
    }
    this.activeRun = (async () => {
      try {
        const result = await startCodexQueuedTurn(
          session,
          this.service.getProjectAuth(opts.projectPath),
          opts.projectPath,
          opts.cwd,
          callbacks,
        )
        const turnUsage = this.completedTurnUsage(result.turnUsage)
        this.recordTurnUsageStats(turnUsage, result.usage, session.model)
        if (runningAssistantId) finalizeSegment(runningAssistantId, { ...result, turnUsage }, result.finalResponse)
      } catch (error) {
        this.recordTurnUsageStats(this.completedTurnUsage(undefined), null, session.model)
        if (runningAssistantId) this.failMessage(runningAssistantId, error)
        throw error
      } finally {
        this.emit({ type: 'status_change', status: 'idle' })
        if (this.currentMessageId === runningAssistantId) this.currentMessageId = null
        this.swapRunAssistantId = null
      }
    })()
    await this.activeRun.finally(() => { this.activeRun = null })
    return true
  }

  private async enqueueDurableMessage(request: SendMessageRequest): Promise<void> {
    const clientMessageId = request.clientMessageId
    const session = this.session
    const handle = session?.connectionHandle
    const threadId = session?.threadId
    if (!clientMessageId || !session || !handle || !threadId) {
      throw new Error('Codex durable queue requires an active thread and client message id')
    }
    const input = buildCodexQueuedInput(request.content, request.images)
    this.durableQueue.set(clientMessageId, { submissionId: null, request, input })
    try {
      const submissionId = await this.addDurableSubmission(clientMessageId, input)
      const queued = this.durableQueue.get(clientMessageId)
      if (queued) queued.submissionId = submissionId
    } catch (err) {
      this.durableQueue.delete(clientMessageId)
      throw err
    }
  }

  private async addDurableSubmission(
    clientMessageId: string,
    input: Array<Record<string, unknown>>,
  ): Promise<string> {
    const session = this.session
    const handle = session?.connectionHandle
    const threadId = session?.threadId
    if (!handle || !threadId) throw new Error('Codex durable queue requires an active thread')
    const result = await handle.connection.request('thread/queue/add', {
      threadId,
      input,
      clientUserMessageId: clientMessageId,
    })
    const submission = result.queuedSubmission && typeof result.queuedSubmission === 'object'
      ? result.queuedSubmission as Record<string, unknown>
      : null
    const submissionId = typeof submission?.id === 'string' ? submission.id : null
    if (!submissionId) throw new Error('Codex returned no durable queue submission id')
    return submissionId
  }

  private consumeDurableMessage(clientMessageId: string, rearmStreaming: boolean): void {
    const queued = this.durableQueue.get(clientMessageId)
    if (!queued) return
    this.durableQueue.delete(clientMessageId)
    this.emit({ type: 'queued_message_consumed', clientMessageId })
    const nextMessageId = queued.request.assistantMessageId
      ?? `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.emit({
      type: 'message_start',
      message: {
        id: nextMessageId,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'codex',
      },
    })
    if (this.swapRunAssistantId) {
      this.swapRunAssistantId(nextMessageId)
    } else {
      this.resetSegments(nextMessageId)
      this.currentMessageId = nextMessageId
    }
    if (rearmStreaming) this.emit({ type: 'status_change', status: 'streaming' })
  }

  private async steerQueuedMessage(clientMessageId: string): Promise<void> {
    if (this.queueRefreshPromise) await this.queueRefreshPromise
    const queued = this.durableQueue.get(clientMessageId)
    const session = this.session
    const handle = session?.connectionHandle
    const threadId = session?.threadId
    if (!queued?.submissionId || !session?.steerFn || !handle || !threadId) {
      throw new Error('Queued message can only steer an active Codex turn')
    }

    this.queueSteerInFlight += 1
    let deleted = false
    try {
      try {
        await handle.connection.request('thread/queue/delete', {
          threadId,
          queuedSubmissionId: queued.submissionId,
        })
        deleted = true
        await steerCodex(session, queued.input)
      } catch (error) {
        if (deleted) {
          try {
            queued.submissionId = await this.addDurableSubmission(clientMessageId, queued.input)
          } catch (restoreError) {
            log.error(
              '[CodexBackend] failed to restore queued message after steer failure: %s',
              restoreError instanceof Error ? restoreError.message : String(restoreError),
            )
          }
        }
        throw error
      }
      this.consumeDurableMessage(clientMessageId, false)
    } finally {
      this.queueSteerInFlight -= 1
      this.flushDurableQueueRefresh()
    }
  }

  private async restoreDurableQueue(): Promise<void> {
    const threadId = this.session?.threadId ?? this.providerSessionId
    if (!threadId) return
    try {
      const connection = await this.ensureManagementConnection()
      let cursor: string | null = null
      const restored: Array<{ clientMessageId: string; content: string }> = []
      const nextQueue = new Map<string, DurableQueuedMessage>()
      do {
        const result = await connection.request('thread/queue/list', {
          threadId,
          ...(cursor ? { cursor } : {}),
          limit: 100,
        })
        const data = Array.isArray(result.data) ? result.data : []
        for (const value of data) {
          if (!value || typeof value !== 'object') continue
          const submission = value as Record<string, unknown>
          const submissionId = typeof submission.id === 'string' ? submission.id : null
          const clientMessageId = typeof submission.clientUserMessageId === 'string'
            ? submission.clientUserMessageId
            : null
          if (!submissionId || !clientMessageId) continue
          const input = Array.isArray(submission.input)
            ? submission.input.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
            : []
          const content = input.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return []
            const rec = entry as Record<string, unknown>
            return rec.type === 'text' && typeof rec.text === 'string' ? [rec.text] : []
          }).join('\n\n')
          const existing = this.durableQueue.get(clientMessageId)
          const request: SendMessageRequest = existing?.request ?? {
            content,
            clientMessageId,
            assistantMessageId: `codex_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            priority: 'next',
          }
          nextQueue.set(clientMessageId, { submissionId, request, input })
          restored.push({ clientMessageId, content })
        }
        cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null
      } while (cursor)
      // Core removes a submission from thread/queue/list as soon as it promotes
      // it to a turn, before the corresponding userMessage item necessarily
      // reaches this client. Keep that local mapping during a live drain so the
      // item event can still atomically move the queued bubble into transcript.
      if (this.isTurnBusy()) {
        for (const [clientMessageId, queued] of this.durableQueue) {
          if (!nextQueue.has(clientMessageId)) nextQueue.set(clientMessageId, queued)
        }
      }
      this.durableQueue.clear()
      for (const [clientMessageId, queued] of nextQueue) this.durableQueue.set(clientMessageId, queued)
      const restoredById = new Map(restored.map((message) => [message.clientMessageId, message]))
      for (const [clientMessageId, queued] of nextQueue) {
        if (!restoredById.has(clientMessageId)) {
          restoredById.set(clientMessageId, { clientMessageId, content: queued.request.content })
        }
      }
      this.emit({ type: 'queued_messages_restored', messages: [...restoredById.values()] })
    } catch (err) {
      log.warn('[CodexBackend] durable queue restore failed: %s', err instanceof Error ? err.message : String(err))
    }
  }

  private scheduleDurableQueueRefresh(threadId: string): void {
    if (threadId !== (this.session?.threadId ?? this.providerSessionId)) return
    this.queueRefreshRequested = true
    this.flushDurableQueueRefresh()
  }

  private flushDurableQueueRefresh(): void {
    if (this.queueSteerInFlight > 0 || this.queueRefreshPromise || !this.queueRefreshRequested) return
    this.queueRefreshPromise = (async () => {
      while (this.queueRefreshRequested) {
        this.queueRefreshRequested = false
        await this.restoreDurableQueue()
      }
    })().finally(() => {
      this.queueRefreshPromise = null
      if (this.queueRefreshRequested) this.flushDurableQueueRefresh()
    })
  }

  async dequeueMessage(_clientMessageId: string): Promise<boolean> {
    const queued = this.durableQueue.get(_clientMessageId)
    if (!queued) return false
    const handle = this.session?.connectionHandle
    const threadId = this.session?.threadId
    if (!handle || !threadId || !queued.submissionId) return false
    try {
      await handle.connection.request('thread/queue/delete', {
        threadId,
        queuedSubmissionId: queued.submissionId,
      })
      this.durableQueue.delete(_clientMessageId)
      return true
    } catch (err) {
      log.warn('[CodexBackend] durable queue delete failed: %s', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  getPendingInteractions(): AgentEvent[] {
    const session = this.session
    if (!session) return []
    return [...session.pendingApprovals.values()].map((p) => p.event)
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

  private interruptSession(): void {
    const session = this.session
    if (!session) return
    try {
      interruptCodex(session)
    } catch (err) {
      log.warn('[CodexBackend] interrupt threw: %s', err instanceof Error ? err.message : String(err))
    }
  }

  private fireProviderSessionId(threadId: string): void {
    if (this.providerSessionId === threadId) return
    this.providerSessionId = threadId
    for (const cb of this.providerSessionIdListeners) {
      try { cb(threadId) } catch (err) { log.warn('[CodexBackend] providerSessionId listener error:', err) }
    }
  }

  private buildCallbacks(): CodexRunStreamCallbacks {
    return {
      hasQueuedMessages: () => this.durableQueue.size > 0,
      onQueuedMessageConsumed: (clientMessageId) => {
        // Both branches, not just the cold one. The live-stream drain reaches
        // here after `onTurnCompleted` already emitted `message_complete` for
        // the previous segment, and the renderer settles a completed current
        // turn to idle — without re-arming, the queued turn (the one an auto
        // compaction pushes a message into) streams into a UI that thinks it
        // stopped, so Stop is not even offered.
        this.consumeDurableMessage(clientMessageId, true)
      },
      onThreadStarted: (threadId: string) => {
        this.fireProviderSessionId(threadId)
        const messageId = this.currentMessageId
        if (!messageId) return
        this.emit({ type: 'codex_thread_started', messageId, threadId })
      },
      onItemDelta: (phase, item) => {
        let owner = this.itemOwner.get(item.id)
        if (!owner) {
          const live = this.currentMessageId
          if (!live) return
          owner = live
          this.itemOwner.set(item.id, owner)
        }
        if (item.type === 'collab_tool_call' && item.tool === 'spawnAgent') {
          for (const tid of item.receiverThreadIds) {
            if (!this.forkOwners.has(tid)) this.forkOwners.set(tid, owner)
          }
        }
        this.recordSegmentItem(owner, item)
        this.emit({ type: 'codex_item_delta', messageId: owner, phase, item })
      },
      emitForkItem: (forkThreadId, phase, item) => {
        const owner = this.itemOwner.get(item.id)
          ?? this.forkOwners.get(forkThreadId)
          ?? this.currentMessageId
        if (!owner) return
        this.itemOwner.set(item.id, owner)
        this.recordSegmentItem(owner, item)
        this.emit({ type: 'codex_item_delta', messageId: owner, phase, item })
      },
      onMcpServerStatus: (servers) => {
        const messageId = this.currentMessageId
        if (!messageId) return
        this.emit({ type: 'codex_mcp_startup', messageId, servers })
      },
      onUsageDelta: (usage) => {
        this.lastUsageSnapshot = usage
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
      onUsageAccounted: (threadId, usage) => {
        const added = this.turnUsage.add(threadId, usage)
        if (!added || !this.turnUsageRecorded) return
        try {
          recordCodexFromUsage(usage, this.session?.model, new Date())
        } catch (err) {
          log.warn('[usage-stats] failed to record late Codex child usage: %s', err instanceof Error ? err.message : String(err))
        }
      },
      onCompactionStarted: () => {
        this.emit({ type: 'status_indicator', indicator: 'compacting' })
      },
      onCompactionCompleted: (info) => {
        const messageId = info.trigger === 'manual' ? this.currentMessageId ?? undefined : undefined
        this.emit({
          type: 'compact_boundary',
          ...info,
          ...(messageId ? { messageId } : {}),
        })
        this.emit({ type: 'status_indicator', indicator: null, compactResult: 'success' })
      },
      onCompactionFailed: (error) => {
        this.emit({ type: 'status_indicator', indicator: null, compactResult: 'failed', compactError: error })
      },
      onPermissionRequest: (request) => {
        this.emit({ type: 'permission_request', request })
      },
      onAskUserQuestion: (request) => {
        this.emit({ type: 'ask_user_question', request })
      },
    }
  }

  private resetSegments(firstId: string): void {
    this.itemOwner.clear()
    this.segments.clear()
    this.finalizedSegments.clear()
    this.lastUsageSnapshot = null
    this.turnUsage = new CodexTurnUsageAccumulator()
    this.turnUsageRecorded = false
    this.ensureSegment(firstId)
  }

  private recordTurnUsageStats(
    turnUsage: CodexRunResult['turnUsage'],
    fallbackUsage: CodexUsageInfo | null,
    model: string | undefined,
  ): void {
    if (this.turnUsageRecorded) return
    try {
      recordCodexFromTurnUsage(turnUsage, fallbackUsage, model, new Date())
    } catch (err) {
      log.warn('[usage-stats] failed to record Codex usage: %s', err instanceof Error ? err.message : String(err))
    } finally {
      this.turnUsageRecorded = true
    }
  }

  private completedTurnUsage(fallback: CodexRunResult['turnUsage']): CodexRunResult['turnUsage'] {
    const accounted = this.turnUsage.snapshot()
    const hasAccountedUsage = accounted.inputTokens > 0
      || accounted.outputTokens > 0
      || accounted.cacheReadInputTokens > 0
      || accounted.cacheCreationInputTokens > 0
    return hasAccountedUsage ? accounted : fallback
  }

  private finalizeMessage(
    messageId: string,
    opts: {
      finalResponseFallback?: string
      threadId: string | null
      turnId?: string
      usage: CodexUsageInfo | null
      turnUsage?: CodexRunResult['turnUsage']
      model?: string
      startedAt: number
    },
  ): void {
    if (this.finalizedSegments.has(messageId)) return
    this.finalizedSegments.add(messageId)
    const seg = this.segments.get(messageId)
    const items = seg
      ? seg.order.map((id) => seg.map.get(id)).filter((item): item is CodexThreadItem => Boolean(item))
      : []
    const finalText = deriveFinalResponse(items).trim() || opts.finalResponseFallback?.trim() || ''
    this.emit({
      type: 'message_complete',
      messageId,
      metadata: {
        codex: {
          finalResponse: finalText,
          durationMs: Date.now() - opts.startedAt,
          items,
          threadId: opts.threadId,
          ...(opts.turnId ? { turnId: opts.turnId } : {}),
          usage: opts.usage,
          ...(opts.turnUsage ? { turnUsage: opts.turnUsage } : {}),
          model: opts.model,
        },
      } as Record<string, unknown>,
    })
  }

  private failMessage(messageId: string, error: unknown): void {
    if (this.finalizedSegments.has(messageId)) return
    this.finalizedSegments.add(messageId)
    const message = error instanceof Error ? error.message : String(error)
    this.emit({
      type: 'message_error',
      messageId,
      error: message,
      errorInfo: buildAgentErrorInfo(message, readCodexErrorOverrides(error)),
    })
  }

  private ensureSegment(messageId: string): { order: string[]; map: Map<string, CodexThreadItem> } {
    let seg = this.segments.get(messageId)
    if (!seg) {
      seg = { order: [], map: new Map() }
      this.segments.set(messageId, seg)
    }
    return seg
  }

  private recordSegmentItem(messageId: string, item: CodexThreadItem): void {
    const seg = this.ensureSegment(messageId)
    if (!seg.map.has(item.id)) seg.order.push(item.id)
    seg.map.set(item.id, item)
  }

  private assertStarted(): void {
    if (!this.started) throw new Error('CodexBackend not started')
    if (this.disposed) throw new Error('CodexBackend already disposed')
  }
}
