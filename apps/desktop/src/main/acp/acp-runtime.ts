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
import {
  coalesceModelConfig,
  extractModelsFromInitializeResult,
  extractModelsFromNewSessionResult,
  extractModelConfig,
  type AcpModelConfig,
} from './acp-config'
import { spawnAcpProcess, type AcpProcessHandle } from './acp-process'
import { mapSessionUpdate, mapStopReason } from './acp-event-map'
import { resolveAcpLaunch, type ResolvedAcpLaunch } from './agent-catalog'
import type { AgentEvent } from '@superone/shared/agent-types'

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
  ): Promise<void>
  cancel(): Promise<void>
  close(): Promise<void>
}

export interface AcpRuntimeOptions {
  launch: AcpRuntimeLaunchConfig
  permission: AcpPermissionGate
  /** Inject stream (in-process agent) instead of spawning a process. */
  streamFactory?: (launch: ResolvedAcpLaunch) => Promise<{ stream: Stream; dispose: () => void }>
  /** Called as soon as a model catalog is known (e.g. after initialize, before session/new). */
  onModelConfig?: (config: AcpModelConfig) => void
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
    connection = client({ name: 'superone' })
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        return opts.permission.request(ctx.params)
      })
      .onRequest(methods.client.fs.readTextFile, async () => ({
        content: '',
      }))
      .onRequest(methods.client.fs.writeTextFile, async () => ({}))
      .connect(stream)

    const initResult = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'superone', version: '0.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    })
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
    async prompt(text, messageId, onEvent) {
      let settled = false
      const fail = (error: string) => {
        if (settled) return
        settled = true
        onEvent({ type: 'message_error', messageId, error })
        onEvent({ type: 'status_change', status: 'error' })
      }

      const connectionLost = activeConnection.closed.then(() => {
        throw new Error(formatProcessExit(exitInfo))
      })

      const promptPromise = activeSession.prompt(text)
      try {
        for (;;) {
          if (closed) throw new Error(formatProcessExit(exitInfo))
          const message = await Promise.race([
            activeSession.nextUpdate(),
            connectionLost,
          ])
          if (message.kind === 'stop') {
            settled = true
            const { complete, interrupted } = mapStopReason(message.stopReason)
            if (interrupted) {
              onEvent({ type: 'message_interrupted', messageId })
            } else if (complete) {
              onEvent({ type: 'message_complete', messageId })
            }
            onEvent({ type: 'status_change', status: 'idle' })
            break
          }
          for (const event of mapSessionUpdate(message.update, { messageId })) {
            onEvent(event)
          }
        }
        await promptPromise
      } catch (err) {
        if (settled) return
        const error = err instanceof Error ? err.message : String(err)
        fail(error)
        throw err
      }
    },
    async cancel() {
      try {
        await activeConnection.agent.notify(methods.agent.session.cancel, {
          sessionId: activeSession.sessionId,
        })
      } catch (err) {
        log.debug('[acp-runtime] cancel failed:', err)
      }
    },
    async close() {
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
