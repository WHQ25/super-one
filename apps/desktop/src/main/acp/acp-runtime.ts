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
  coalesceModelConfig,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
  extractModelConfig,
  type AcpModelConfig,
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
import { resolveAcpLaunch, type ResolvedAcpLaunch } from './agent-catalog'
import { handleReadTextFile, handleWriteTextFile } from './acp-fs'
import { AcpTerminalManager } from './acp-terminals'
import {
  XAI_ASK_USER_QUESTION,
  type GrokAskUserQuestionParams,
} from './acp-xai-extensions'
import { pushBashOutput } from '../bash-output-watcher'
import type { AgentEvent, ImageAttachment } from '@superone/shared/agent-types'

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

export interface AcpRuntime {
  readonly sessionId: string
  readonly launch: ResolvedAcpLaunch
  getConfigOptions(): SessionConfigOption[]
  getModelConfig(): AcpModelConfig | null
  setConfigOption(configId: string, value: string): Promise<SessionConfigOption[]>
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
  launch: AcpRuntimeLaunchConfig
  permission: AcpPermissionGate
  askUserQuestion?: AcpAskUserQuestionGate
  /** Inject stream (in-process agent) instead of spawning a process. */
  streamFactory?: (launch: ResolvedAcpLaunch) => Promise<{ stream: Stream; dispose: () => void }>
  /** Called as soon as a model catalog is known (e.g. after initialize, before session/new). */
  onModelConfig?: (config: AcpModelConfig) => void
  /**
   * Session-level updates outside an active prompt (available_commands, config, …).
   * Prompt-turn events still go to the prompt onEvent callback.
   */
  onSessionEvent?: (event: AgentEvent) => void
  getUnsaved?: (absolutePath: string) => string | null | undefined
  additionalRoots?: string[]
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

  try {
    const askUserHandler = async (ctx: { params: unknown }) => {
      const params = (ctx.params && typeof ctx.params === 'object' ? ctx.params : {}) as GrokAskUserQuestionParams
      if (!opts.askUserQuestion) {
        log.warn('[acp-runtime] x.ai/ask_user_question with no gate — cancelling')
        return { cancelled: {} }
      }
      return opts.askUserQuestion.request(params)
    }

    connection = client({ name: 'superone' })
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
      .onRequest(XAI_ASK_USER_QUESTION, askUserHandler)
      .onRequest(`_${XAI_ASK_USER_QUESTION}`, askUserHandler)
      .connect(stream)

    const initResult = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'superone', version: '0.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      _meta: {
        askUserQuestion: true,
      },
    } as never)
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

    session = await connection.agent.buildSession(launch.cwd).start()
    sessionModels = extractModelsFromNewSessionResult(session.newSessionResponse)
    const resolvedModels = coalesceModelConfig(sessionModels, initModels)
    if (resolvedModels) opts.onModelConfig?.(resolvedModels)
    log.info(
      '[acp-runtime] session ready id=%s agent=%s configOptions=%d models=%d',
      session.sessionId,
      launch.agentId,
      session.newSessionResponse.configOptions?.length ?? 0,
      resolvedModels?.models.length ?? 0,
    )
  } catch (err) {
    processHandle?.kill()
    disposeStream?.()
    connection?.close(err)
    const base = err instanceof Error ? err.message : String(err)
    if (exitInfo) throw new Error(`${base}. ${formatProcessExit(exitInfo)}`)
    throw err
  }

  const activeSession = session
  const activeConnection = connection
  let configOptions: SessionConfigOption[] = [...(activeSession.newSessionResponse.configOptions ?? [])]
  let modelConfig: AcpModelConfig | null = coalesceModelConfig(
    sessionModels,
    initModels,
    extractModelConfig(configOptions),
  )
  let closed = false
  void activeConnection.closed.then(() => {
    closed = true
  })

  // Single consumer for session/update — start immediately after session/new so
  // available_commands_update (often sent right after create) is not missed.
  // Route to the active prompt callback when one is in flight.
  let promptGen = 0
  let promptMessageId: string | null = null
  let promptOnEvent: ((event: AgentEvent) => void) | null = null
  const promptStopWaiters: Array<(stopReason: string) => void> = []
  let pumping = true
  /** Agent-side messageId → local assistant message id for multi-message turns. */
  const agentMsgToLocal = new Map<string, string>()
  let openToolIds = new Set<string>()
  let primaryPromptMessageId: string | null = null

  const deliver = (event: AgentEvent) => {
    if (event.type === 'acp_commands') {
      log.info(
        '[acp-runtime] available_commands agent=%s count=%d',
        launch.agentId,
        event.commands.length,
      )
    }
    if (promptOnEvent) promptOnEvent(event)
    else opts.onSessionEvent?.(event)
  }

  void (async () => {
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
        const message = next.m
        if (message.kind === 'stop') {
          const waiter = promptStopWaiters.shift()
          if (waiter) waiter(String(message.stopReason))
          else log.debug('[acp-runtime] stop with no active prompt reason=%s', message.stopReason)
          continue
        }
        const update = message.update
        trace('acp.session', update.sessionUpdate, update, promptMessageId ?? activeSession.sessionId)
        let messageId = promptMessageId ?? `acp_session_${activeSession.sessionId}`
        const agentMid = getAgentChunkMessageId(update)
        if (agentMid && promptOnEvent) {
          const existing = agentMsgToLocal.get(agentMid)
          if (existing) {
            messageId = existing
            promptMessageId = existing
          } else if (agentMsgToLocal.size === 0 && primaryPromptMessageId) {
            agentMsgToLocal.set(agentMid, primaryPromptMessageId)
            messageId = primaryPromptMessageId
            promptMessageId = primaryPromptMessageId
          } else {
            const newId = `acp_msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
            agentMsgToLocal.set(agentMid, newId)
            messageId = newId
            promptMessageId = newId
            deliver({
              type: 'message_start',
              message: {
                id: newId,
                role: 'assistant',
                status: 'streaming',
                content: [],
                createdAt: new Date().toISOString(),
                providerId: 'acp',
              },
            })
          }
        }
        const mapped = mapSessionUpdate(update, { messageId }, {
          resolveTerminalCommand: (id) => terminalManager.getCommandLine(id),
          resolveTerminalOutput: (id) => terminalManager.getOutput(id),
          onTerminalEmbedded: (terminalId, toolUseId) => {
            terminalManager.bindTool(terminalId, toolUseId)
          },
        })
        trackOpenTools(openToolIds, mapped)
        for (const event of mapped) {
          deliver(event)
        }
      } catch (err) {
        if (!closed) log.debug('[acp-runtime] update pump ended:', err)
        break
      }
    }
  })()

  return {
    sessionId: activeSession.sessionId,
    launch,
    getConfigOptions() {
      return configOptions
    },
    getModelConfig() {
      return modelConfig
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
      }
      return configOptions
    },
    async prompt(text, messageId, onEvent, images) {
      let settled = false
      const fail = (error: string) => {
        if (settled) return
        settled = true
        onEvent({ type: 'message_error', messageId, error })
        onEvent({ type: 'status_change', status: 'error' })
      }

      const gen = ++promptGen
      let stopWaiter: ((stopReason: string) => void) | null = null
      const stopPromise = new Promise<string>((resolve) => {
        stopWaiter = resolve
        promptStopWaiters.push(resolve)
      })
      promptMessageId = messageId
      primaryPromptMessageId = messageId
      promptOnEvent = onEvent
      agentMsgToLocal.clear()
      openToolIds = new Set()

      const promptBlocks = await buildAcpPromptContentAsync(text, {
        images,
        cwd: launch.cwd,
        getUnsaved: (abs) => opts.getUnsaved?.(abs) ?? getUnsavedBuffer(abs),
      })
      const promptPromise = activeSession.prompt(promptBlocks as never)
      try {
        const stopReason = await Promise.race([
          stopPromise,
          activeConnection.closed.then(() => {
            throw new Error(formatProcessExit(exitInfo))
          }),
        ])
        settled = true
        const { complete, interrupted } = mapStopReason(stopReason)
        const localIds = new Set<string>([primaryPromptMessageId ?? messageId, ...agentMsgToLocal.values()])
        if (interrupted) {
          for (const ev of cancelOpenToolEvents(promptMessageId ?? messageId, openToolIds)) {
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
        await promptPromise
      } catch (err) {
        if (settled) return
        const error = err instanceof Error ? err.message : String(err)
        fail(error)
        throw err
      } finally {
        if (gen === promptGen) {
          promptMessageId = null
          primaryPromptMessageId = null
          promptOnEvent = null
          agentMsgToLocal.clear()
          openToolIds.clear()
        }
        if (stopWaiter) {
          const idx = promptStopWaiters.indexOf(stopWaiter)
          if (idx >= 0) promptStopWaiters.splice(idx, 1)
        }
      }
    },
    async cancel() {
      if (promptOnEvent && promptMessageId) {
        for (const ev of cancelOpenToolEvents(promptMessageId, openToolIds)) {
          promptOnEvent(ev)
        }
      }
      try {
        await activeConnection.agent.notify(methods.agent.session.cancel, {
          sessionId: activeSession.sessionId,
        })
      } catch (err) {
        log.debug('[acp-runtime] cancel failed:', err)
      }
    },
    async close() {
      pumping = false
      closed = true
      try { terminalManager.dispose() } catch { /* ignore */ }
      try { activeSession.dispose() } catch { /* ignore */ }
      try { activeConnection.close() } catch { /* ignore */ }
      try {
        await Promise.race([
          activeConnection.closed.catch(() => undefined),
          new Promise((r) => setTimeout(r, 50)),
        ])
      } catch { /* ignore */ }
      processHandle?.kill()
      try { disposeStream?.() } catch { /* ignore */ }
    },
  }
}
