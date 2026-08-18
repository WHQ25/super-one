import {
  client,
  methods,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type Stream,
} from '@agentclientprotocol/sdk'
import log from '../logger'
import { trace } from '../agent/event-trace'
import {
  ACP_SESSION_SET_MODEL,
  buildSetModelParams,
  coalesceModeConfig,
  coalesceModelConfig,
  extractModeConfig,
  extractModelConfig,
  extractModesFromNewSessionResult,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
  readAgentCapabilities,
  type AcpAgentCapabilities,
  type AcpModeConfig,
  type AcpModelConfig,
  type AcpSetModelOptions,
} from './acp-config'
import { spawnAcpProcess, type AcpProcessHandle } from './acp-process'
import {
  buildAcpPromptContentAsync,
  cancelOpenToolEvents,
  getAgentChunkMessageId,
  mapSessionUpdate,
  mapStopReason,
  trackOpenTools,
} from './acp-event-map'
import { getUnsavedBuffer } from './acp-unsaved-buffer'
import { resolveAcpClientVersion } from './acp-client-info'
import {
  clearMainThreadSessionGuard,
  noteAcpTaskLifecycle,
} from '../mcp/main-thread-session-guard'
import { buildAcpSessionMcpServers } from './acp-mcp'
import { ACP_SYSTEM_PROMPT_BLOCK } from '../agent/superone-system-prompt'
import { resolveAcpLaunch, type ResolvedAcpLaunch } from './agent-catalog'
import { handleReadTextFile, handleWriteTextFile } from './acp-fs'
import { AcpTerminalManager } from './acp-terminals'
import {
  XAI_ASK_USER_QUESTION,
  XAI_BILLING,
  XAI_EXIT_PLAN_MODE,
  XAI_RECAP,
  XAI_YOLO_MODE_CHANGED,
  parseGrokExitPlanModeParams,
  formatGrokExitPlanModeResponse,
  xaiExtWireMethod,
  type GrokAskUserQuestionParams,
  type GrokExitPlanModeParams,
} from './acp-xai-extensions'
import {
  XAI_EXT_NOTIFICATION_METHODS,
  XAI_SESSION_NOTIFICATION,
  XAI_SESSION_UPDATE,
  createXaiCorrelationState,
  mapXaiStandaloneNotification,
  noteContextTokensFromMeta,
  noteContextWindow,
  noteToolCorrelationFromAgentEvents,
  parseXaiExtParams,
  type XaiCorrelationState,
} from './acp-xai-session-notify'
import {
  GROK_ACP_CLIENT_IDENTIFIER,
  grokSessionPermissionMeta,
  grokYoloModeNotificationParams,
} from './acp-permission-preapprove'
import { parseGrokBilling } from './acp-billing'
import { describeAcpRequestFailure } from './acp-request-error'
import { pushBashOutput } from '../bash-output-watcher'
import type {
  AgentErrorInfo,
  AgentEvent,
  ContextUsageInfo,
  ImageAttachment,
  PermissionMode,
  ProviderRateLimits,
} from '@superone/shared/agent-types'

/**
 * How long `cancel()` waits for the agent's own stop before settling the turn
 * locally. Grok ignores `session/cancel` when the turn already died server-side
 * (quota exhausted), and without this the Stop button would do nothing.
 */
const CANCEL_STOP_FALLBACK_MS = 2000

/**
 * Consecutive `nextUpdate()` rejections tolerated before the pump gives up.
 * A rejected `session/prompt` pushes its error through the session update queue
 * (ACP SDK `ActiveSession.prompt`), which is recoverable — but a disposed or
 * closed queue rejects forever, so the pump still needs a floor.
 */
const MAX_CONSECUTIVE_PUMP_ERRORS = 5

export interface AcpRuntimeLaunchConfig {
  agentId?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  defaultCwd: string
}

export interface AcpPermissionGate {
  request(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
}

/** Grok (and similar) client extension: interactive multi-choice questions. */
export interface AcpAskUserQuestionGate {
  request(params: GrokAskUserQuestionParams): Promise<Record<string, unknown>>
}

/** Grok client extension: plan approval when agent calls exit_plan_mode. */
export interface AcpExitPlanModeGate {
  request(params: GrokExitPlanModeParams): Promise<Record<string, unknown>>
}

export interface AcpRuntime {
  readonly sessionId: string
  readonly launch: ResolvedAcpLaunch
  getConfigOptions(): SessionConfigOption[]
  getModelConfig(): AcpModelConfig | null
  /** Session modes (OpenCode-style) or Grok reasoning-effort options. */
  getModeConfig(): AcpModeConfig | null
  setConfigOption(configId: string, value: string): Promise<SessionConfigOption[]>
  /**
   * Switch model via ACP session/set_model (Grok and agents without configOptions model id).
   * Optional reasoningEffort is sent as `_meta.reasoningEffort`.
   */
  setModel(modelId: string, opts?: AcpSetModelOptions): Promise<void>
  /**
   * Map SuperOne permission / plan mode onto Grok ACP:
   * - `plan` → session/set_mode plan (not yolo)
   * - other → session/set_mode default + x.ai/yolo_mode_changed
   */
  setPermissionMode(mode: PermissionMode): Promise<void>
  /** ACP session/set_mode (plan | ask | default). */
  setAcpSessionMode(modeId: string): Promise<void>
  /** Context usage from x.ai turn_completed / subagent progress (null until first sample). */
  getContextUsage(): Promise<ContextUsageInfo | null>
  /**
   * Grok Build credits + subscription tier for the usage gauge. Null when the
   * agent has no billing surface (non-Grok ACP agents, API-key auth, offline).
   */
  getRateLimits(): Promise<ProviderRateLimits | null>
  /**
   * Whether initialize `_meta.sessionRecap` advertised recap (Grok fail-closed until true).
   */
  isSessionRecapAvailable(): boolean
  /**
   * Fire-and-forget `x.ai/recap` (auto return-from-away or manual).
   * Result arrives later as `session_recap` session notification.
   */
  requestRecap(auto: boolean): Promise<void>
  prompt(
    text: string,
    messageId: string,
    onEvent: (event: AgentEvent) => void,
    images?: ImageAttachment[],
  ): Promise<void>
  cancel(): Promise<void>
  close(): Promise<void>
}

export interface AcpRuntimeOptions {
  signal?: AbortSignal
  launch: AcpRuntimeLaunchConfig
  permission: AcpPermissionGate
  askUserQuestion?: AcpAskUserQuestionGate
  exitPlanMode?: AcpExitPlanModeGate
  /** Inject stream (in-process agent) instead of spawning a process. */
  streamFactory?: (launch: ResolvedAcpLaunch) => Promise<{ stream: Stream; dispose: () => void }>
  /** Called as soon as a model catalog is known (e.g. after initialize, before session/new). */
  onModelConfig?: (config: AcpModelConfig) => void
  /** Called when mode/effort options are known (session/new). */
  onModeConfig?: (config: AcpModeConfig) => void
  /**
   * Session-level updates outside an active prompt (available_commands, config, …).
   * Prompt-turn events still go to the prompt onEvent callback.
   */
  onSessionEvent?: (event: AgentEvent) => void
  getUnsaved?: (absolutePath: string) => string | null | undefined
  additionalRoots?: string[]
  /** SuperOne session id — scopes the built-in MCP bridge to this session. */
  superoneSessionId?: string
  /** SuperOne session permission mode — mapped to Grok yolo/auto on session/new. */
  permissionMode?: PermissionMode
  /**
   * Provider (agent) session id to resume via session/load when the agent
   * advertises loadSession. Falls back to session/new on failure.
   */
  resumeSessionId?: string
  /** Extra SuperOne instructions hidden inside the first ACP prompt (ACP has no system channel). */
  systemPromptAppend?: string
  /** Override the post-`session/cancel` local stop fallback (tests). */
  cancelStopFallbackMs?: number
}

/**
 * ClientContext.attachSession is private in the SDK typings but available at
 * runtime — required so we can route session/update *during* session/load.
 */
type AcpAgentWithAttach = {
  attachSession(response: {
    sessionId: string
    configOptions?: SessionConfigOption[] | null
    modes?: unknown
    _meta?: Record<string, unknown> | null
    [key: string]: unknown
  }): ActiveSession
}

/** Content that must land on an assistant bubble (user prompt or agent auto-wake). */
function isAgentInitiatedContentUpdate(update: { sessionUpdate?: string }): boolean {
  const kind = update.sessionUpdate
  return kind === 'agent_message_chunk'
    || kind === 'agent_thought_chunk'
    || kind === 'tool_call'
    || kind === 'tool_call_update'
    || kind === 'plan'
}

/**
 * Grok durable turn terminal (`turn_completed` on the session_notification rail).
 * Used to close SuperOne assistant bubbles for agent-initiated auto-wake turns.
 */
function isXaiTurnCompletedNotification(method: string, params: Record<string, unknown>): boolean {
  const bare = method.replace(/^_/, '')
  if (bare !== XAI_SESSION_NOTIFICATION && bare !== XAI_SESSION_UPDATE) return false
  const update = (params.update && typeof params.update === 'object' && !Array.isArray(params.update))
    ? params.update as Record<string, unknown>
    : null
  if (!update) return false
  const kind = update.sessionUpdate ?? update.session_update
  return kind === 'turn_completed'
}

/** Discard historical session/update events replayed by session/load (UI uses SuperOne DB). */
async function drainLoadReplay(session: ActiveSession, maxQuietMs = 40, maxEvents = 20_000): Promise<number> {
  let drained = 0
  for (;;) {
    if (drained >= maxEvents) break
    const msg = await Promise.race([
      session.nextUpdate().then((m) => ({ kind: 'msg' as const, m })),
      new Promise<{ kind: 'quiet' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'quiet' }), maxQuietMs)
      }),
    ])
    if (msg.kind === 'quiet') break
    drained += 1
  }
  return drained
}

function formatProcessExit(
  info: { code: number | null; signal: NodeJS.Signals | null; stderr: string } | null,
): string {
  if (!info) return 'ACP agent process exited'
  const parts = [`ACP agent process exited (code=${info.code ?? 'null'}, signal=${info.signal ?? 'null'})`]
  const stderr = info.stderr.trim()
  if (stderr) parts.push(stderr.slice(0, 500))
  return parts.join(': ')
}

export async function createAcpRuntime(opts: AcpRuntimeOptions): Promise<AcpRuntime> {
  if (opts.signal?.aborted) throw new Error('ACP runtime initialization aborted')
  const launch = resolveAcpLaunch(opts.launch)
  const fsRoots = [launch.cwd, ...(opts.additionalRoots ?? [])].filter(Boolean)
  const terminalManager = new AcpTerminalManager({
    projectPath: launch.cwd,
    allowedRoots: fsRoots,
    onOutput: ({ toolUseId, content, finished }) => {
      if (!toolUseId) return
      pushBashOutput(toolUseId, content, finished)
    },
  })
  let processHandle: AcpProcessHandle | null = null
  let disposeStream: (() => void) | null = null
  let stream: Stream
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null; stderr: string } | null = null

  if (opts.streamFactory) {
    const custom = await opts.streamFactory(launch)
    stream = custom.stream
    disposeStream = custom.dispose
  } else {
    try {
      processHandle = spawnAcpProcess(launch)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to start ACP agent "${launch.agentId}" (${launch.command} ${launch.args.join(' ')}): ${msg}`,
      )
    }
    stream = processHandle.stream
    void processHandle.closed.then((info) => {
      exitInfo = info
    })
  }

  let connection: ClientConnection | null = null
  let session: ActiveSession | null = null
  let initModels: AcpModelConfig | null = null
  let sessionModels: AcpModelConfig | null = null
  let agentCapabilities: AcpAgentCapabilities | null = null
  let mcpAttached = false
  /** Grok initialize `_meta.sessionRecap` — fail-closed until advertised true. */
  let sessionRecapAvailable = false

  // xAI progressive bus — handlers bind before session is ready; deliver is wired later.
  const xaiCorrelation: XaiCorrelationState = createXaiCorrelationState({
    cwd: launch.cwd,
  })
  let xaiDeliver: ((event: AgentEvent) => void) | null = null
  let xaiMessageId: (() => string | null) | null = null
  /** Late-bound: close agent-initiated auto-wake turns on turn_completed. */
  const agentWakeCtl = {
    isPromptActive: () => false,
    hasOpen: () => false,
    complete: (_reason: 'complete' | 'interrupted' = 'complete') => {},
  }

  const handleXaiExtNotification = async (
    method: string,
    ctx: { params: Record<string, unknown> },
  ): Promise<void> => {
    try {
      const events = mapXaiStandaloneNotification(
        method,
        ctx.params,
        xaiCorrelation,
        { messageId: xaiMessageId?.() ?? null },
      )
      log.debug(
        '[acp-runtime] x.ai ext method=%s events=%d',
        method,
        events.length,
      )
      for (const event of events) {
        if (opts.superoneSessionId) noteAcpTaskLifecycle(opts.superoneSessionId, event)
        xaiDeliver?.(event)
      }
      // Durable turn end for agent-initiated wakes (workflow-completed-*, …).
      // Grok does not call session/prompt for these — SuperOne must close the bubble.
      if (
        isXaiTurnCompletedNotification(method, ctx.params)
        && !agentWakeCtl.isPromptActive()
        && agentWakeCtl.hasOpen()
      ) {
        agentWakeCtl.complete('complete')
      }
    } catch (err) {
      log.warn('[acp-runtime] x.ai ext handler error method=%s:', method, err)
    }
  }

  const abortError = new Error('ACP runtime initialization aborted')
  const abortInitialization = () => {
    try { terminalManager.dispose() } catch { /* ignore */ }
    try { connection?.close(abortError) } catch { /* ignore */ }
    try { disposeStream?.() } catch { /* ignore */ }
    void processHandle?.kill().catch(() => undefined)
  }
  opts.signal?.addEventListener('abort', abortInitialization, { once: true })
  if (opts.signal?.aborted) abortInitialization()

  try {
    // Custom (non-spec) methods require the 3-arg onRequest form with a params
    // parser; the 2-arg form throws for any method the SDK does not know.
    const askUserParams = (raw: unknown): GrokAskUserQuestionParams =>
      (raw && typeof raw === 'object' ? raw : {}) as GrokAskUserQuestionParams
    const askUserHandler = async (ctx: { params: GrokAskUserQuestionParams }) => {
      if (!opts.askUserQuestion) {
        log.warn('[acp-runtime] x.ai/ask_user_question with no gate — cancelling')
        return { outcome: 'cancelled' }
      }
      return opts.askUserQuestion.request(ctx.params)
    }
    const exitPlanParams = (raw: unknown): GrokExitPlanModeParams => parseGrokExitPlanModeParams(raw)
    const exitPlanHandler = async (ctx: { params: GrokExitPlanModeParams }) => {
      if (!opts.exitPlanMode) {
        log.warn('[acp-runtime] x.ai/exit_plan_mode with no gate — abandoning')
        return formatGrokExitPlanModeResponse({ kind: 'abandoned' })
      }
      return opts.exitPlanMode.request(ctx.params)
    }

    let clientBuilder = client({ name: 'superone' })
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        return opts.permission.request(ctx.params)
      })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        return handleReadTextFile(ctx.params, {
          roots: fsRoots,
          getUnsaved: (abs) => opts.getUnsaved?.(abs) ?? getUnsavedBuffer(abs),
        })
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        return handleWriteTextFile(ctx.params, { roots: fsRoots })
      })
      .onRequest(methods.client.terminal.create, async (ctx) => terminalManager.create(ctx.params))
      .onRequest(methods.client.terminal.output, async (ctx) => terminalManager.output(ctx.params))
      .onRequest(methods.client.terminal.waitForExit, async (ctx) => terminalManager.waitForExit(ctx.params))
      .onRequest(methods.client.terminal.kill, async (ctx) => terminalManager.kill(ctx.params))
      .onRequest(methods.client.terminal.release, async (ctx) => terminalManager.release(ctx.params))
      // Grok Build interactive tools — both bare and underscore-prefixed method ids
      .onRequest(XAI_ASK_USER_QUESTION, askUserParams, askUserHandler)
      .onRequest(`_${XAI_ASK_USER_QUESTION}`, askUserParams, askUserHandler)
      .onRequest(XAI_EXIT_PLAN_MODE, exitPlanParams, exitPlanHandler)
      .onRequest(`_${XAI_EXIT_PLAN_MODE}`, exitPlanParams, exitPlanHandler)

    // Grok progressive ExtNotification bus (workflow / subagent / bg / usage / …)
    for (const method of XAI_EXT_NOTIFICATION_METHODS) {
      const m = method
      clientBuilder = clientBuilder.onNotification(
        m,
        parseXaiExtParams,
        async (ctx) => {
          await handleXaiExtNotification(m, ctx)
        },
      )
    }

    connection = clientBuilder.connect(stream)

    const clientVersion = resolveAcpClientVersion()
    // Grok runs locally and its read_file supports binary images. Advertising
    // ACP's text-only filesystem would route every read through UTF-8 and corrupt
    // PNG/JPEG bytes. Let Grok use its local filesystem, as we already do for its
    // terminal; retain the host filesystem bridge for other ACP agents.
    const useHostDelegation = launch.agentId !== 'grok-build'
    const initResult = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'superone', version: clientVersion },
      clientCapabilities: {
        fs: { readTextFile: useHostDelegation, writeTextFile: useHostDelegation },
        terminal: useHostDelegation,
      },
      _meta: {
        askUserQuestion: true,
        // Advertise plan-approval capability so Grok parks exit_plan_mode on us.
        exitPlanMode: true,
        // Fallback for origin_client when session/new _meta is sparse.
        clientIdentifier: GROK_ACP_CLIENT_IDENTIFIER,
      },
    } as never)
    agentCapabilities = readAgentCapabilities(initResult)
    {
      const meta = (initResult as { _meta?: Record<string, unknown> | null })._meta
      sessionRecapAvailable = meta?.sessionRecap === true
      log.info(
        '[acp-runtime] initialize agent=%s sessionRecap=%s',
        launch.agentId,
        sessionRecapAvailable,
      )
    }
    initModels = extractModelsFromInitializeResult(initResult)
    if (initModels) opts.onModelConfig?.(initModels)

    // Only auto-run non-interactive auth. OpenCode's `opencode-login` is interactive
    // (terminal browser flow) and must not block session setup / model loading.
    const initAny = initResult as {
      authMethods?: Array<{ id?: string; type?: string }>
      _meta?: Record<string, unknown> | null
    }
    const authMethods = Array.isArray(initAny.authMethods) ? initAny.authMethods : []
    const defaultAuthId =
      typeof initAny._meta?.defaultAuthMethodId === 'string'
        ? initAny._meta.defaultAuthMethodId
        : null
    const isNonInteractiveAuth = (id: string | undefined): boolean => {
      if (!id) return false
      const lower = id.toLowerCase()
      return lower === 'cached_token'
        || lower.includes('cached')
        || lower.includes('api_key')
        || lower.includes('apikey')
        || lower.includes('token')
    }
    const methodId =
      (defaultAuthId && isNonInteractiveAuth(defaultAuthId) && authMethods.some((m) => m.id === defaultAuthId)
        ? defaultAuthId
        : null)
      ?? authMethods.find((m) => isNonInteractiveAuth(m.id))?.id
      ?? null
    if (methodId) {
      try {
        await connection.agent.request(methods.agent.authenticate, { methodId })
        log.info('[acp-runtime] authenticated method=%s agent=%s', methodId, launch.agentId)
      } catch (err) {
        log.warn('[acp-runtime] authenticate failed method=%s:', methodId, err)
      }
    } else if (authMethods.length > 0) {
      log.info(
        '[acp-runtime] skip interactive auth methods agent=%s methods=%s',
        launch.agentId,
        authMethods.map((m) => m.id).join(','),
      )
    }

    const mcpServers = buildAcpSessionMcpServers({
      cwd: launch.cwd,
      superoneSessionId: opts.superoneSessionId,
      agentCapabilities,
    })
    mcpAttached = mcpServers.some((s) => s.name === 'superone')
    const extraRoots = fsRoots.slice(1)
    const supportsExtraRoots = agentCapabilities?.sessionCapabilities.additionalDirectories ?? false
    const permissionMeta = grokSessionPermissionMeta(opts.permissionMode)
    const sessionRequestBase = {
      cwd: launch.cwd,
      mcpServers,
      ...(extraRoots.length > 0 && supportsExtraRoots
        ? { additionalDirectories: extraRoots }
        : {}),
      ...(Object.keys(permissionMeta).length > 0
        ? { _meta: permissionMeta }
        : {}),
    }

    let sessionVia: 'new' | 'load' = 'new'
    const resumeId = opts.resumeSessionId?.trim() || ''
    const loadSessionCap = agentCapabilities?.loadSession === true
    if (resumeId && loadSessionCap) {
      try {
        // Attach routing *before* load so replayed session/update is not dropped.
        const sessionResponse: {
          sessionId: string
          configOptions?: SessionConfigOption[] | null
          modes?: unknown
          _meta?: Record<string, unknown> | null
          [key: string]: unknown
        } = { sessionId: resumeId }
        const agentWithAttach = connection.agent as unknown as AcpAgentWithAttach
        const loaded = agentWithAttach.attachSession(sessionResponse)
        const loadResult = await connection.agent.request(
          methods.agent.session.load,
          {
            sessionId: resumeId,
            ...sessionRequestBase,
          },
        ) as {
          configOptions?: SessionConfigOption[] | null
          modes?: unknown
          _meta?: Record<string, unknown> | null
        } | null | undefined
        if (loadResult && typeof loadResult === 'object') {
          if (loadResult.configOptions !== undefined) sessionResponse.configOptions = loadResult.configOptions
          if (loadResult.modes !== undefined) sessionResponse.modes = loadResult.modes
          if (loadResult._meta !== undefined) sessionResponse._meta = loadResult._meta
        }
        const replayed = await drainLoadReplay(loaded)
        session = loaded
        sessionVia = 'load'
        log.info(
          '[acp-runtime] session/load ok id=%s agent=%s replayed=%d',
          resumeId,
          launch.agentId,
          replayed,
        )
      } catch (err) {
        log.warn(
          '[acp-runtime] session/load failed id=%s agent=%s — falling back to session/new:',
          resumeId,
          launch.agentId,
          err,
        )
        try { session?.dispose() } catch { /* ignore */ }
        session = null
      }
    } else if (resumeId && !loadSessionCap) {
      log.info(
        '[acp-runtime] session/new (agent loadSession=false) resume=%s agent=%s',
        resumeId,
        launch.agentId,
      )
    } else {
      log.info(
        '[acp-runtime] session/new (no resumeSessionId) agent=%s superone=%s',
        launch.agentId,
        opts.superoneSessionId ?? '(none)',
      )
    }

    if (!session) {
      let builder = connection.agent.buildSession(sessionRequestBase)
      // buildSession already has cwd/mcpServers; re-apply additional dirs if helper expects chain API
      if (extraRoots.length > 0 && supportsExtraRoots) {
        builder = builder.withAdditionalDirectories(extraRoots)
      }
      session = await builder.start()
      sessionVia = 'new'
      if (resumeId && loadSessionCap) {
        // Load was attempted and failed — new id will overwrite the stored provider
        // session id via onProviderSessionIdChange. Call out explicitly for ops.
        log.warn(
          '[acp-runtime] session/new after failed load; prior resume id=%s will be replaced by id=%s agent=%s',
          resumeId,
          session.sessionId,
          launch.agentId,
        )
      }
    }
    if (!session) throw new Error('ACP session not established')

    sessionModels = extractModelsFromNewSessionResult(session.newSessionResponse)
    const resolvedModels = coalesceModelConfig(sessionModels, initModels)
    if (resolvedModels) opts.onModelConfig?.(resolvedModels)
    const sessionModes = extractModesFromNewSessionResult(session.newSessionResponse)
    if (sessionModes) opts.onModeConfig?.(sessionModes)
    log.info(
      '[acp-runtime] session ready via=%s id=%s agent=%s configOptions=%d models=%d modes=%d mcp=%d superone=%s roots=%d',
      sessionVia,
      session.sessionId,
      launch.agentId,
      session.newSessionResponse.configOptions?.length ?? 0,
      resolvedModels?.models.length ?? 0,
      sessionModes?.modes.length ?? 0,
      mcpServers.length,
      mcpAttached ? 'yes' : 'no',
      supportsExtraRoots ? extraRoots.length : 0,
    )
    // Host-selected plan mode before runtime existed — apply after session is live.
    if (opts.permissionMode === 'plan') {
      try {
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId: session.sessionId,
          modeId: 'plan',
        })
        log.info('[acp-runtime] session/set_mode plan on create agent=%s', launch.agentId)
      } catch (err) {
        log.warn('[acp-runtime] session/set_mode plan on create failed:', err)
      }
    }
  } catch (err) {
    opts.signal?.removeEventListener('abort', abortInitialization)
    await processHandle?.kill().catch(() => undefined)
    disposeStream?.()
    connection?.close(err)
    const base = err instanceof Error ? err.message : String(err)
    if (exitInfo) throw new Error(`${base}. ${formatProcessExit(exitInfo)}`)
    throw err
  }

  opts.signal?.removeEventListener('abort', abortInitialization)

  const activeSession = session
  const activeConnection = connection
  let configOptions: SessionConfigOption[] = [...(activeSession.newSessionResponse.configOptions ?? [])]
  let modelConfig: AcpModelConfig | null = coalesceModelConfig(
    sessionModels,
    initModels,
    extractModelConfig(configOptions),
  )
  let modeConfig: AcpModeConfig | null = coalesceModeConfig(
    extractModesFromNewSessionResult(activeSession.newSessionResponse),
    extractModeConfig(configOptions),
  )
  const seedContextWindowFromModels = (cfg: AcpModelConfig | null) => {
    if (!cfg?.selectedModelId) return
    const m = cfg.models.find((x) => x.id === cfg.selectedModelId)
    if (m?.contextWindow && m.contextWindow > 0) noteContextWindow(xaiCorrelation, m.contextWindow)
  }
  seedContextWindowFromModels(modelConfig)
  let closed = false
  void activeConnection.closed.then(() => {
    closed = true
  })

  // Single consumer for session/update — start immediately after session/new so
  // available_commands_update (often sent right after create) is not missed.
  // Route to the active prompt callback when one is in flight.
  let promptGen = 0
  const promptStopWaiters: Array<(stopReason: string) => void> = []
  let pumping = true
  /**
   * Per-turn streaming state. A newer `session/prompt` must never mutate an
   * older turn's ids: Grok ends the previous turn with `stopReason: cancelled`
   * only *after* the replacement prompt is in flight, so a turn that reads
   * shared module state at settle time would stamp `message_interrupted` onto
   * the newer bubble (and leave its own tool blocks spinning).
   */
  interface AcpTurnScope {
    /** Agent-side messageId → local assistant message id for multi-message turns. */
    readonly agentMsgToLocal: Map<string, string>
    readonly openToolIds: Set<string>
    /** Local bubble the turn is currently streaming into. */
    lastMessageId: string | null
  }
  interface AcpPromptTurn extends AcpTurnScope {
    readonly gen: number
    readonly primaryMessageId: string
    readonly onEvent: (event: AgentEvent) => void
  }
  const newTurnScope = (lastMessageId: string | null = null): AcpTurnScope => ({
    agentMsgToLocal: new Map<string, string>(),
    openToolIds: new Set<string>(),
    lastMessageId,
  })
  let currentTurn: AcpPromptTurn | null = null
  /** Scope for agent-initiated (auto-wake) streaming, which runs only while no prompt is live. */
  let wakeScope: AcpTurnScope = newTurnScope()
  /** The scope owning whatever is streaming right now. */
  const scope = (): AcpTurnScope => currentTurn ?? wakeScope
  /**
   * Read `currentTurn` through a call so the update pump (an IIFE, which
   * inherits outer control-flow narrowing) does not see the `= null` initializer.
   */
  const liveTurn = (): AcpPromptTurn | null => currentTurn
  let systemPromptSent = false
  /**
   * Grok auto-wake (WorkflowCompleted / TaskCompleted / NotificationDrain) runs a
   * synthetic turn without SuperOne calling session/prompt. Streamed
   * agent_message_chunk / tool_call must still open a local assistant bubble.
   * Completion depends on xAI turn terminal (`turn_completed` / orphan stop) or
   * the next SuperOne user prompt (which finalizes the wake bubble first).
   */
  let agentInitiatedMessageId: string | null = null

  const deliver = (event: AgentEvent) => {
    if (event.type === 'acp_commands') {
      log.info(
        '[acp-runtime] available_commands agent=%s count=%d',
        launch.agentId,
        event.commands.length,
      )
    }
    if (currentTurn) currentTurn.onEvent(event)
    else opts.onSessionEvent?.(event)
  }

  const startAssistantMessage = (id: string, opts?: { emitStatus?: boolean }) => {
    deliver({
      type: 'message_start',
      message: {
        id,
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    // Mid-prompt multi-message only needs message_start; auto-wake also flips session status.
    if (opts?.emitStatus !== false) {
      deliver({ type: 'status_change', status: 'streaming' })
    }
    xaiCorrelation.lastMessageId = id
  }

  const completeAgentInitiated = (
    reason: 'complete' | 'interrupted' = 'complete',
    options: { emitIdle?: boolean } = {},
  ) => {
    const id = agentInitiatedMessageId
    if (!id || currentTurn) return
    for (const ev of cancelOpenToolEvents(id, wakeScope.openToolIds)) {
      deliver(ev)
    }
    wakeScope.openToolIds.clear()
    if (reason === 'interrupted') {
      deliver({ type: 'message_interrupted', messageId: id })
    } else {
      deliver({ type: 'message_complete', messageId: id })
    }
    if (options.emitIdle !== false) {
      deliver({ type: 'status_change', status: 'idle' })
    }
    agentInitiatedMessageId = null
    // Drop agentMid→local maps so late chunks cannot re-home onto a completed bubble.
    wakeScope.agentMsgToLocal.clear()
    log.debug('[acp-runtime] completed agent-initiated turn messageId=%s reason=%s', id, reason)
  }

  const ensureAgentInitiatedMessage = (agentMid: string | null): string => {
    if (agentMid) {
      const existing = wakeScope.agentMsgToLocal.get(agentMid)
      if (existing) {
        agentInitiatedMessageId = existing
        return existing
      }
    }
    if (agentInitiatedMessageId) {
      if (agentMid) wakeScope.agentMsgToLocal.set(agentMid, agentInitiatedMessageId)
      return agentInitiatedMessageId
    }
    const newId = `acp_wake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    agentInitiatedMessageId = newId
    if (agentMid) wakeScope.agentMsgToLocal.set(agentMid, newId)
    startAssistantMessage(newId)
    log.debug('[acp-runtime] opened agent-initiated turn messageId=%s agentMid=%s', newId, agentMid)
    return newId
  }

  // Wire xAI ExtNotification delivery (handlers registered above close over these).
  // progressive events often arrive after session/prompt returns → onSessionEvent path.
  xaiDeliver = deliver
  xaiMessageId = () =>
    currentTurn?.lastMessageId ?? currentTurn?.primaryMessageId ?? agentInitiatedMessageId
  agentWakeCtl.isPromptActive = () => !!currentTurn
  agentWakeCtl.hasOpen = () => !!agentInitiatedMessageId
  agentWakeCtl.complete = completeAgentInitiated

  void (async () => {
    let consecutiveErrors = 0
    while (pumping && !closed) {
      try {
        let connectionClosed = false
        const next = await Promise.race([
          activeSession.nextUpdate().then((m) => ({ type: 'msg' as const, m })),
          activeConnection.closed.then(() => {
            connectionClosed = true
            return { type: 'closed' as const }
          }),
        ])
        if (connectionClosed || next.type === 'closed' || closed || !pumping) break
        consecutiveErrors = 0
        const message = next.m
        if (message.kind === 'stop') {
          const waiter = promptStopWaiters.shift()
          if (waiter) waiter(String(message.stopReason))
          else {
            // Agent-initiated turn end (rare stop without SuperOne prompt).
            log.debug('[acp-runtime] stop with no active prompt reason=%s', message.stopReason)
            completeAgentInitiated('complete')
          }
          continue
        }
        const update = message.update
        // Grok stamps live context occupancy on every session/update `_meta.totalTokens`.
        const notifMeta = (message as { notification?: { _meta?: Record<string, unknown> | null } }).notification?._meta
        const prevContextTokens = xaiCorrelation.lastUsage?.totalTokens ?? 0
        if (notifMeta) noteContextTokensFromMeta(xaiCorrelation, notifMeta)
        const nextContextTokens = xaiCorrelation.lastUsage?.totalTokens ?? 0
        const contextChanged = nextContextTokens > 0 && nextContextTokens !== prevContextTokens
        const turn = liveTurn()
        trace('acp.session', update.sessionUpdate, update, turn?.lastMessageId ?? activeSession.sessionId)
        let messageId = turn?.lastMessageId
          ?? agentInitiatedMessageId
          ?? `acp_session_${activeSession.sessionId}`
        const agentMid = getAgentChunkMessageId(update)
        if (turn) {
          if (agentMid) {
            const existing = turn.agentMsgToLocal.get(agentMid)
            if (existing) {
              messageId = existing
              turn.lastMessageId = existing
            } else if (turn.agentMsgToLocal.size === 0) {
              turn.agentMsgToLocal.set(agentMid, turn.primaryMessageId)
              messageId = turn.primaryMessageId
              turn.lastMessageId = turn.primaryMessageId
            } else {
              const newId = `acp_msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
              turn.agentMsgToLocal.set(agentMid, newId)
              messageId = newId
              turn.lastMessageId = newId
              // Already streaming under the user prompt — do not re-emit status.
              startAssistantMessage(newId, { emitStatus: false })
            }
          }
        } else if (isAgentInitiatedContentUpdate(update)) {
          // Workflow / task / notification auto-wake while SuperOne is idle.
          messageId = ensureAgentInitiatedMessage(agentMid)
        }
        const mapped = mapSessionUpdate(update, { messageId }, {
          resolveTerminalCommand: (id) => terminalManager.getCommandLine(id),
          resolveTerminalOutput: (id) => terminalManager.getOutput(id),
          onTerminalEmbedded: (terminalId, toolUseId) => {
            terminalManager.bindTool(terminalId, toolUseId)
          },
        })
        // When occupancy changes, push a context-only usage event so the ring
        // updates mid-turn without clobbering footer in/out.
        if (contextChanged && xaiCorrelation.lastUsage) {
          const max = xaiCorrelation.lastUsage.maxTokens
          mapped.push({
            type: 'message_usage',
            messageId,
            inputTokens: 0,
            outputTokens: 0,
            contextTokens: xaiCorrelation.lastUsage.totalTokens,
            ...(max > 0 ? { contextWindow: max } : {}),
          })
        }
        trackOpenTools(scope().openToolIds, mapped)
        const migrate = noteToolCorrelationFromAgentEvents(mapped, xaiCorrelation)
        const superoneSid = opts.superoneSessionId
        if (superoneSid) {
          for (const event of mapped) {
            noteAcpTaskLifecycle(superoneSid, event)
          }
        }
        for (const event of mapped) {
          deliver(event)
        }
        for (const event of migrate) {
          deliver(event)
        }
      } catch (err) {
        if (closed || !pumping) break
        // A failed session/prompt is delivered as a queue rejection, not a stop.
        // Breaking here would leave a zombie runtime that never streams again,
        // so keep pumping — the queue serves later notifications normally.
        consecutiveErrors += 1
        if (consecutiveErrors >= MAX_CONSECUTIVE_PUMP_ERRORS) {
          log.debug('[acp-runtime] update pump ended after %d errors:', consecutiveErrors, err)
          break
        }
        log.debug('[acp-runtime] update pump error %d/%d:', consecutiveErrors, MAX_CONSECUTIVE_PUMP_ERRORS, err)
      }
    }
  })()
  const setAcpSessionMode: AcpRuntime['setAcpSessionMode'] = async (modeId) => {
    const id = modeId.trim() || 'default'
    try {
      await activeConnection.agent.request(methods.agent.session.setMode, {
        sessionId: activeSession.sessionId,
        modeId: id,
      })
      log.info('[acp-runtime] session/set_mode agent=%s modeId=%s', launch.agentId, id)
    } catch (err) {
      log.warn('[acp-runtime] session/set_mode failed agent=%s modeId=%s:', launch.agentId, id, err)
      throw err
    }
  }

  return {
    sessionId: activeSession.sessionId,
    launch,
    isSessionRecapAvailable: () => sessionRecapAvailable,
    async requestRecap(auto) {
      if (!sessionRecapAvailable) {
        log.debug('[acp-runtime] requestRecap skipped — sessionRecap not advertised')
        return
      }
      try {
        await activeConnection.agent.request(xaiExtWireMethod(XAI_RECAP), {
          sessionId: activeSession.sessionId,
          auto,
        })
        log.info(
          '[acp-runtime] x.ai/recap agent=%s session=%s auto=%s',
          launch.agentId,
          activeSession.sessionId,
          auto,
        )
      } catch (err) {
        log.warn(
          '[acp-runtime] x.ai/recap failed agent=%s auto=%s:',
          launch.agentId,
          auto,
          err,
        )
        throw err
      }
    },
    getConfigOptions() {
      return configOptions
    },
    getModelConfig() {
      return modelConfig
    },
    getModeConfig() {
      return modeConfig
    },
    async setConfigOption(configId, value) {
      const result = await activeConnection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: activeSession.sessionId,
        configId,
        value,
      })
      if (Array.isArray(result.configOptions)) {
        configOptions = result.configOptions
        modelConfig = coalesceModelConfig(extractModelConfig(configOptions), modelConfig)
        modeConfig = coalesceModeConfig(extractModeConfig(configOptions), modeConfig)
      }
      return configOptions
    },
    async setModel(modelId, setOpts) {
      const params = buildSetModelParams(activeSession.sessionId, modelId, setOpts)
      await activeConnection.agent.request(ACP_SESSION_SET_MODEL, params)
      if (modelConfig && modelConfig.models.some((m) => m.id === modelId)) {
        modelConfig = {
          ...modelConfig,
          selectedModelId: modelId,
        }
      } else if (modelConfig) {
        // Agent accepted a model not in our cached list — still track selection.
        modelConfig = { ...modelConfig, selectedModelId: modelId }
      } else {
        modelConfig = {
          configId: null,
          models: [{ id: modelId, name: modelId, description: '' }],
          selectedModelId: modelId,
        }
      }
      seedContextWindowFromModels(modelConfig)
      if (setOpts?.reasoningEffort && modeConfig) {
        const effort = setOpts.reasoningEffort.trim()
        if (effort && modeConfig.modes.some((m) => m.id === effort)) {
          modeConfig = { ...modeConfig, selectedModeId: effort }
        } else if (effort) {
          modeConfig = { ...modeConfig, selectedModeId: effort }
        }
      }
      log.info(
        '[acp-runtime] session/set_model agent=%s model=%s effort=%s',
        launch.agentId,
        modelId,
        setOpts?.reasoningEffort ?? '',
      )
    },
    setAcpSessionMode,
    async getContextUsage() {
      return xaiCorrelation.lastUsage
    },
    async getRateLimits() {
      try {
        log.info('[acp-runtime] x.ai/billing request agent=%s', launch.agentId)
        const raw = await activeConnection.agent.request(xaiExtWireMethod(XAI_BILLING), {})
        const limits = parseGrokBilling(raw)
        if (!limits) {
          const keys = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? Object.keys(raw as Record<string, unknown>).join(',')
            : typeof raw
          log.info('[acp-runtime] x.ai/billing unparsed agent=%s shape=%s', launch.agentId, keys)
          return null
        }
        log.info(
          '[acp-runtime] x.ai/billing agent=%s plan=%s used=%s%%',
          launch.agentId,
          limits.planType ?? '(none)',
          limits.windows[0]?.usedPercent ?? '?',
        )
        return limits
      } catch (err) {
        // Expected for non-Grok agents (method not found) and API-key auth
        // (billing needs the grok.com OAuth session), so never louder than debug.
        log.debug('[acp-runtime] x.ai/billing unavailable agent=%s:', launch.agentId, err)
        return null
      }
    },
    async setPermissionMode(mode) {
      // Plan is ACP session mode, not Grok yolo/auto permission baseline.
      if (mode === 'plan') {
        try {
          await setAcpSessionMode('plan')
        } catch (err) {
          log.warn('[acp-runtime] enter plan mode failed agent=%s:', launch.agentId, err)
        }
        return
      }
      // Leaving plan (or switching permission): restore agent mode then yolo baseline.
      try {
        await setAcpSessionMode('default')
      } catch (err) {
        log.debug('[acp-runtime] set_mode default before yolo (may be unsupported):', err)
      }
      const params = grokYoloModeNotificationParams(mode)
      try {
        await activeConnection.agent.notify(xaiExtWireMethod(XAI_YOLO_MODE_CHANGED), params)
        log.info(
          '[acp-runtime] yolo_mode_changed agent=%s mode=%s params=%j',
          launch.agentId,
          mode,
          params,
        )
      } catch (err) {
        log.warn('[acp-runtime] yolo_mode_changed failed agent=%s mode=%s:', launch.agentId, mode, err)
      }
    },
    async prompt(text, messageId, onEvent, images) {
      let settled = false
      const fail = (errorInfo: AgentErrorInfo) => {
        if (settled) return
        settled = true
        for (const ev of cancelOpenToolEvents(turn.lastMessageId ?? messageId, turn.openToolIds)) {
          onEvent(ev)
        }
        onEvent({ type: 'message_error', messageId, error: errorInfo.raw, errorInfo })
        onEvent({ type: 'status_change', status: 'error' })
      }

      // Finish any in-flight agent auto-wake before a user-driven prompt. AcpBackend
      // has already emitted streaming for the new prompt, so do not overwrite it with idle.
      if (agentInitiatedMessageId) {
        completeAgentInitiated('complete', { emitIdle: false })
      }

      const gen = ++promptGen
      let stopWaiter: ((stopReason: string) => void) | null = null
      const stopPromise = new Promise<string>((resolve) => {
        stopWaiter = resolve
        promptStopWaiters.push(resolve)
      })
      // Own scope per turn: a replacement prompt swaps `currentTurn` without
      // touching this turn's ids, so a late cancel still settles on its own.
      const turn: AcpPromptTurn = {
        ...newTurnScope(messageId),
        gen,
        primaryMessageId: messageId,
        onEvent,
      }
      currentTurn = turn
      wakeScope = newTurnScope()
      xaiCorrelation.lastMessageId = messageId

      const promptBlocks = await buildAcpPromptContentAsync(text, {
        images,
        cwd: launch.cwd,
        getUnsaved: (abs) => opts.getUnsaved?.(abs) ?? getUnsavedBuffer(abs),
      })
      // ACP carries no system-prompt field; ride the first prompt instead. Gated on
      // mcpAttached — without the tools it names, the text would be instructions to nowhere.
      if (!systemPromptSent && mcpAttached) {
        systemPromptSent = true
        promptBlocks.unshift({
          type: 'text',
          text: [ACP_SYSTEM_PROMPT_BLOCK, opts.systemPromptAppend].filter(Boolean).join('\n\n'),
        })
      }
      const promptPromise = activeSession.prompt(promptBlocks as never)
      // A rejected session/prompt (Grok quota exhausted → JSON-RPC -32003) never
      // produces a stop message, so its failure must be raced explicitly or the
      // turn hangs in `streaming` forever. Success stays on the stop rail: the
      // SDK queues the response as a stop, and consuming it here instead would
      // leave that stale stop to settle the *next* turn's waiter.
      const promptFailure = promptPromise.then<string>(
        () => new Promise<string>(() => {}),
        (err) => { throw err },
      )
      try {
        const stopReason = await Promise.race([
          stopPromise,
          promptFailure,
          activeConnection.closed.then(() => {
            throw new Error(formatProcessExit(exitInfo))
          }),
        ])
        settled = true
        const { complete, interrupted } = mapStopReason(stopReason)
        const localIds = new Set<string>([turn.primaryMessageId, ...turn.agentMsgToLocal.values()])
        if (interrupted) {
          for (const ev of cancelOpenToolEvents(turn.lastMessageId ?? messageId, turn.openToolIds)) {
            onEvent(ev)
          }
          for (const id of localIds) {
            onEvent({ type: 'message_interrupted', messageId: id })
          }
        } else if (complete) {
          for (const id of localIds) {
            onEvent({ type: 'message_complete', messageId: id })
          }
        }
        onEvent({ type: 'status_change', status: 'idle' })
      } catch (err) {
        if (settled) return
        fail(describeAcpRequestFailure(err))
        throw err
      } finally {
        // Only the newest turn owns `currentTurn`; an older turn settling late
        // must leave the live one alone.
        if (gen === promptGen && currentTurn === turn) currentTurn = null
        turn.agentMsgToLocal.clear()
        turn.openToolIds.clear()
        if (stopWaiter) {
          const idx = promptStopWaiters.indexOf(stopWaiter)
          if (idx >= 0) promptStopWaiters.splice(idx, 1)
        }
      }
    },
    async cancel() {
      const turn = currentTurn
      if (turn?.lastMessageId) {
        for (const ev of cancelOpenToolEvents(turn.lastMessageId, turn.openToolIds)) {
          turn.onEvent(ev)
        }
      }
      const waiter = promptStopWaiters[0] ?? null
      try {
        await activeConnection.agent.notify(methods.agent.session.cancel, {
          sessionId: activeSession.sessionId,
        })
      } catch (err) {
        log.debug('[acp-runtime] cancel failed:', err)
      }
      // Grok drops session/cancel when the turn already died server-side, so the
      // agent stop never arrives. Settle locally rather than leave Stop inert.
      if (!waiter) return
      const fallbackMs = opts.cancelStopFallbackMs ?? CANCEL_STOP_FALLBACK_MS
      setTimeout(() => {
        const idx = promptStopWaiters.indexOf(waiter)
        if (idx < 0) return
        promptStopWaiters.splice(idx, 1)
        log.warn('[acp-runtime] no agent stop %dms after cancel — settling turn locally', fallbackMs)
        waiter('cancelled')
      }, fallbackMs).unref?.()
    },
    async close() {
      pumping = false
      closed = true
      if (opts.superoneSessionId) clearMainThreadSessionGuard(opts.superoneSessionId)
      try { terminalManager.dispose() } catch { /* ignore */ }
      try { activeSession.dispose() } catch { /* ignore */ }
      try { activeConnection.close() } catch { /* ignore */ }
      try {
        await Promise.race([
          activeConnection.closed.catch(() => undefined),
          new Promise((r) => setTimeout(r, 50)),
        ])
      } catch { /* ignore */ }
      // Escalate to SIGKILL if the agent ignores SIGTERM (OpenCode acp has been
      // observed to linger for hours after a bare child.kill()).
      await processHandle?.kill().catch(() => undefined)
      try { disposeStream?.() } catch { /* ignore */ }
    },
  }
}
