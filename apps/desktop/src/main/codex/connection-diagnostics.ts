import { redactHarnessDiagnosticText } from '@superone/shared/environment'
import type { ResolvedService } from '@superone/shared/platform-registry'
import log from '../logger'

const WAIT_LOG_INTERVAL_MS = 60_000
const LIFECYCLE_METHODS = new Set([
  'proxy/ensure', 'initialize', 'thread/start', 'thread/resume', 'thread/fork',
  'turn/start', 'turn/steer', 'turn/interrupt',
])
const OUTPUT_METHODS = new Set([
  'item/agentMessage/delta', 'item/reasoning/textDelta', 'item/reasoning/summaryTextDelta',
])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** Preserve the route needed to diagnose /v1 mistakes, never URL credentials or query values. */
function diagnosticUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}${url.search ? '?[REDACTED]' : ''}`
  } catch {
    return '[invalid URL]'
  }
}

interface WaitingStage {
  startedAt: number
  lastEventAt: number
  lastEvent: string
  notifications: number
  receivedOutput: boolean
}

/** Production-safe metadata only; deliberately independent of dev-only raw event traces. */
export function createCodexConnectionDiagnostics(options: {
  connectionId: string
  env: NodeJS.ProcessEnv
  provider: ResolvedService | null
  apiProviderId?: string | null
  explicitCliOverrides: boolean
}) {
  const { connectionId, env, provider } = options
  const secrets = [...new Set([
    provider?.apiKey,
    ...Object.entries(env).filter(([key]) => /key|token|secret|password|authorization/i.test(key)).map(([, value]) => value),
  ].filter((value): value is string => Boolean(value)))].sort((a, b) => b.length - a.length)
  const redact = (value: string): string => {
    value = value.replace(/\x1b\[[0-9;]*m/g, '')
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]')
    value = value.replace(/https?:\/\/[^\s"'<>]+/g, diagnosticUrl)
    // Upstream errors can embed an entire HTTP body. Keep only the preceding diagnostic.
    value = value.split(/\b(?:body|payload)\s*[:=]|\{|\[\s*\{/i)[0]
    return redactHarnessDiagnosticText(value.replace(/[\r\n\x00-\x1f]+/g, ' '))
  }
  const scalar = (value: unknown): string | number | boolean | undefined => {
    if (typeof value === 'string') return redact(value)
    if (typeof value === 'number' || typeof value === 'boolean') return value
    return undefined
  }
  const errorFields = (error: unknown) => {
    const detail = record(error)
    const info = detail.codexErrorInfo
    return {
      errorCode: scalar(detail.code),
      message: typeof detail.message === 'string' ? redact(detail.message) : undefined,
      errorKind: typeof info === 'string' ? scalar(info) : scalar(Object.keys(record(info))[0]),
      httpStatusCode: Object.values(record(info)).map((v) => record(v).httpStatusCode).find((v) => typeof v === 'number'),
    }
  }
  const write = (event: string, fields: Record<string, unknown> = {}, warn = false) => {
    const message = JSON.stringify({ connectionId, event, ...fields })
    if (warn) log.warn('[codex.diagnostic] %s', message)
    else log.info('[codex.diagnostic] %s', message)
  }
  const selection = (params: Record<string, unknown>) => Object.fromEntries(
    ['threadId', 'turnId', 'model', 'model_provider', 'effort', 'serviceTier']
      .map((key) => [key, scalar(params[key])]),
  )
  let mcpSessionId: unknown
  const logMcpConfig = (method: string, params: Record<string, unknown>) => {
    if (method !== 'thread/start' && method !== 'thread/resume') return
    const config = record(record(record(params.config).mcp_servers).superone)
    const headers = record(config.http_headers)
    // Register injected credentials before any upstream error can echo them.
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== 'string' || !value || name.toLowerCase() === 'x-superone-session-id') continue
      if (!secrets.includes(value)) secrets.push(value)
      const token = /^Bearer /i.test(value) ? value.slice(7) : ''
      if (token && !secrets.includes(token)) secrets.push(token)
    }
    secrets.sort((a, b) => b.length - a.length)
    mcpSessionId = headers['X-SuperOne-Session-Id']
    write('mcp_config', {
      method, sessionId: scalar(mcpSessionId), threadId: scalar(params.threadId),
      injected: Boolean(config.url), enabled: scalar(config.enabled),
      url: typeof config.url === 'string' ? scalar(diagnosticUrl(config.url)) : undefined,
      startupTimeoutSec: scalar(config.startup_timeout_sec),
      hasAuthorization: Object.keys(headers).some((name) => name.toLowerCase() === 'authorization'),
    }, !config.url)
  }
  const pending = new Map<number, { method: string; startedAt: number }>()
  const turns = new Map<string, WaitingStage & { threadId: string; turnId: string }>()
  const completedTurns = new Set<string>()
  let nextRequest = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let stderrBuffer = ''
  let discardStderrLine = false
  let lastStderr: string | undefined
  let disposed = false
  const stopIfIdle = () => {
    if (pending.size || turns.size) return
    clearInterval(timer)
    timer = undefined
  }
  const watch = () => {
    if (timer || disposed) return
    timer = setInterval(() => {
      const now = Date.now()
      for (const stage of pending.values()) {
        if (now - stage.startedAt >= WAIT_LOG_INTERVAL_MS) {
          write('waiting', { method: stage.method, elapsedMs: now - stage.startedAt, lastStderr }, true)
        }
      }
      for (const turn of turns.values()) {
        if (now - turn.startedAt < WAIT_LOG_INTERVAL_MS) continue
        write('waiting', {
          threadId: scalar(turn.threadId), turnId: scalar(turn.turnId), elapsedMs: now - turn.startedAt,
          lastEvent: turn.lastEvent, lastEventAgoMs: now - turn.lastEventAt,
          notifications: turn.notifications, receivedOutput: turn.receivedOutput, lastStderr,
        }, true)
      }
    }, WAIT_LOG_INTERVAL_MS)
    timer.unref()
  }
  const trackTurn = (threadId: string, turnId: string, startedAt: number, lastEvent: string) => {
    const key = `${threadId}:${turnId}`
    if (disposed || turns.has(key) || completedTurns.has(key)) return
    turns.set(key, { threadId, turnId, startedAt, lastEventAt: Date.now(), lastEvent, notifications: 0, receivedOutput: false })
    watch()
  }

  write('provider', {
    requestedProviderId: scalar(options.apiProviderId), credentialId: scalar(provider?.credentialId),
    platformId: scalar(provider?.platformId), endpointId: scalar(provider?.endpointId),
    protocol: scalar(provider?.protocol), baseUrl: provider?.baseUrl ? redact(diagnosticUrl(provider.baseUrl)) : undefined,
    route: provider ? (provider.protocol === 'openai-chat' ? 'chat-proxy' : 'direct') : 'codex-config',
    hasApiKey: Boolean(env.CODEX_API_KEY), explicitCliOverrides: options.explicitCliOverrides,
    extraEnvKeys: Object.keys(provider?.extraEnv ?? {}),
    proxyEnvKeys: ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].filter((key) => Boolean(env[key])),
    customCodexHome: Boolean(env.CODEX_HOME),
  })

  return {
    async request<T>(method: string, params: Record<string, unknown> | undefined, run: () => Promise<T>): Promise<T> {
      logMcpConfig(method, params ?? {})
      const id = ++nextRequest
      const startedAt = Date.now()
      const tracked = LIFECYCLE_METHODS.has(method)
      if (tracked) {
        pending.set(id, { method, startedAt })
        write('request_started', { method, stageId: id, ...selection(params ?? {}) })
        watch()
      }
      try {
        const result = await run()
        const turn = record(record(result).turn)
        if (method === 'turn/start' && typeof params?.threadId === 'string' && typeof turn.id === 'string'
          && !['completed', 'failed', 'interrupted'].includes(String(turn.status))) {
          // An accepted turn can stall before its first notification arrives.
          trackTurn(params.threadId, turn.id, startedAt, 'turn/start:accepted')
        }
        if (method === 'mcpServerStatus/list') {
          const data = record(result).data
          const superone = Array.isArray(data) ? data.map(record).find((server) => server.name === 'superone') : undefined
          const toolsError = superone?.toolsError ?? superone?.tools_error
          write('mcp_snapshot', {
            sessionId: scalar(mcpSessionId), threadId: scalar(params?.threadId),
            present: Boolean(superone), hasNextPage: Boolean(record(result).nextCursor),
            runtimeStatus: scalar(superone?.runtimeStatus ?? superone?.runtime_status),
            authStatus: scalar(superone?.authStatus), toolCount: Object.keys(record(superone?.tools)).length,
            toolsError: scalar(toolsError),
          }, Boolean(toolsError))
        }
        if (tracked) write('request_completed', {
          method, stageId: id, elapsedMs: Date.now() - startedAt,
          threadId: scalar(record(record(result).thread).id), turnId: scalar(record(record(result).turn).id),
          ...(method === 'proxy/ensure' ? { proxyEnabled: Boolean(result) } : {}),
        })
        return result
      } catch (error) {
        write('request_failed', { method, stageId: id, elapsedMs: Date.now() - startedAt, ...errorFields(error), lastStderr }, true)
        throw error
      } finally {
        pending.delete(id)
        stopIfIdle()
      }
    },
    notification(method: string, params: Record<string, unknown>) {
      if (disposed) return
      const threadId = typeof params.threadId === 'string' ? params.threadId : ''
      const turnId = typeof params.turnId === 'string' ? params.turnId : record(params.turn).id
      const key = `${threadId}:${typeof turnId === 'string' ? turnId : ''}`
      if (method === 'turn/started' && typeof turnId === 'string') {
        trackTurn(threadId, turnId, Date.now(), method)
        write('turn_started', { threadId: scalar(threadId), turnId: scalar(turnId) })
      }
      for (const turn of turns.values()) {
        if (turn.threadId !== threadId || (typeof turnId === 'string' && turn.turnId !== turnId)) continue
        turn.lastEvent = method
        turn.lastEventAt = Date.now()
        turn.notifications++
        if (!turn.receivedOutput && OUTPUT_METHODS.has(method) && typeof params.delta === 'string' && params.delta.length > 0) {
          turn.receivedOutput = true
          write('first_output', { threadId: scalar(threadId), turnId: scalar(turn.turnId), method, elapsedMs: Date.now() - turn.startedAt })
        }
      }
      if (method === 'error') write('provider_error', {
        threadId: scalar(threadId), turnId: scalar(turnId), willRetry: params.willRetry === true,
        ...errorFields(params.error ?? params), lastStderr,
      }, true)
      if (method === 'mcpServer/startupStatus/updated') write('mcp_startup', {
        sessionId: scalar(mcpSessionId), threadId: scalar(threadId),
        name: scalar(params.name), status: scalar(params.status), failureReason: scalar(params.failureReason),
        error: scalar(typeof params.error === 'string' ? params.error : record(params.error).message),
        ...(params.status === 'failed' ? { lastStderr } : {}),
      }, params.status === 'failed' || params.status === 'cancelled')
      if (method === 'turn/completed') {
        const turn = turns.get(key)
        write('turn_completed', {
          threadId: scalar(threadId), turnId: scalar(turnId), status: scalar(record(params.turn).status),
          elapsedMs: turn ? Date.now() - turn.startedAt : undefined,
          ...errorFields(record(params.turn).error),
        })
        turns.delete(key)
        // Bounded history prevents a late RPC response from re-opening a completed turn.
        completedTurns.add(key)
        if (completedTurns.size > 64) completedTurns.delete(completedTurns.values().next().value!)
        stopIfIdle()
      }
    },
    stderr(chunk: string) {
      // Buffer complete lines before redaction: a credential can span arbitrary stream chunks.
      if (discardStderrLine) {
        const newline = chunk.indexOf('\n')
        if (newline < 0) return
        chunk = chunk.slice(newline + 1)
        discardStderrLine = false
      }
      stderrBuffer += chunk
      const lines = stderrBuffer.split(/\r?\n/)
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const plainLine = line.replace(/\x1b\[[0-9;]*m/g, '')
        if (/\b(?:warn|error)\b/i.test(plainLine)) lastStderr = redact(plainLine)
        // MCP failures can be non-fatal to the thread, so persist them even
        // when no request fails and no startup notification reaches the UI.
        if (/\b(?:warn|error)\b/i.test(plainLine) && /\bmcp\b|rmcp|mcp_client|mcp_connection/i.test(plainLine)) {
          write('mcp_stderr', { sessionId: scalar(mcpSessionId), message: redact(plainLine) }, true)
        }
      }
      // Discard an oversized unterminated line, rather than retaining a partial secret for logging.
      if (stderrBuffer.length > 16_384) {
        stderrBuffer = ''
        discardStderrLine = true
      }
    },
    close() {
      disposed = true
      pending.clear()
      turns.clear()
      completedTurns.clear()
      clearInterval(timer)
      timer = undefined
    },
  }
}
