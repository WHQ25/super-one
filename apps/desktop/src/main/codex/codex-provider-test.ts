import type { CodexProviderTestProgress } from '@superone/shared/agent-types'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { resolveProbeCwd } from '../agent/probe-cwd'
import {
  asRecord,
  buildCodexProviderCliOverrides,
  buildCodexProviderTestEnv,
  compactRecord,
  createAppServerConnection,
  makeCodexProviderOverride,
  readString,
  type AppServerConnection,
  type AppServerConnectionHandle,
  type AppServerNotification,
} from './app-server-connection'

export interface CodexProviderTestInput {
  api_key: string
  base_url: string
  extra_env: string
  name?: string
  model?: string
}

export interface CodexProviderTestResult {
  success: boolean
  models: number
  error?: string
}

export type CodexTestConnectionFactory = (
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  cliOverrides: string[],
) => Promise<AppServerConnectionHandle>

export type CodexTestProgressFn = (progress: CodexProviderTestProgress) => void

const PHASE_TIMEOUT_MS = 30_000
const PROBE_PROMPT = 'Reply with "ok" only.'
const TERMINAL_HTTP_STATUSES = new Set([400, 401, 403, 404])

const defaultFactory: CodexTestConnectionFactory = (env, signal, cliOverrides) =>
  createAppServerConnection({ mode: 'apiKey' }, signal, env, cliOverrides)

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 32)
  }
}

function extraEnvKeys(raw: string): string[] {
  try {
    return Object.keys(JSON.parse(raw || '{}') as Record<string, unknown>)
  } catch {
    return []
  }
}

function codexErrorHttpStatus(params: Record<string, unknown>): number | null {
  const err = asRecord(params.error)
  const info = err ? asRecord(err.codexErrorInfo) : null
  if (!info) return null
  for (const value of Object.values(info)) {
    const rec = asRecord(value)
    const code = rec && typeof rec.httpStatusCode === 'number' ? rec.httpStatusCode : null
    if (code !== null) return code
  }
  return null
}

function pickNotificationError(params: Record<string, unknown>): string {
  const err = asRecord(params.error)
  const message = err ? readString(err.message) : readString(params.message)
  const details = err ? readString(err.additionalDetails) : null
  if (details && (!message || /reconnect/i.test(message))) return details
  if (message) return message
  if (details) return details
  const nestedMsg = err ? readString(err.message) : null
  if (nestedMsg) return nestedMsg
  const turn = asRecord(params.turn)
  const turnErr = turn ? asRecord(turn.error) : null
  const turnMsg = turnErr ? readString(turnErr.message) : null
  return turnMsg ?? 'Codex turn failed'
}

function abortable<T>(p: Promise<T>, signal: AbortSignal, timeoutMessage: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(timeoutMessage))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(timeoutMessage))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

async function runPhase<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PHASE_TIMEOUT_MS)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

interface ListedModels {
  ids: string[]
  defaultModel: string | null
}

async function listProviderModels(connection: AppServerConnection): Promise<ListedModels> {
  const res = await connection.request('model/list', compactRecord({ limit: 100 }))
  const data = Array.isArray(res.data) ? res.data : []
  const ids: string[] = []
  let defaultModel: string | null = null
  for (const raw of data) {
    const rec = asRecord(raw)
    if (!rec) continue
    const id = readString(rec.model) ?? readString(rec.id)
    if (!id) continue
    ids.push(id)
    if (defaultModel === null && rec.isDefault === true) defaultModel = id
  }
  return { ids, defaultModel: defaultModel ?? ids[0] ?? null }
}

const PHASE_TIMEOUT_SECONDS = PHASE_TIMEOUT_MS / 1000

export async function testCodexProvider(
  input: CodexProviderTestInput,
  factory: CodexTestConnectionFactory = defaultFactory,
  onProgress?: CodexTestProgressFn,
): Promise<CodexProviderTestResult> {
  const baseUrl = input.base_url?.trim() ?? ''
  const requestedModel = input.model?.trim() || ''

  trace('codex.providertest', 'start', {
    hasKey: Boolean(input.api_key),
    baseUrl: baseUrl ? safeHost(baseUrl) : '',
    requestedModel: requestedModel || '(from model/list)',
    extraEnvKeys: extraEnvKeys(input.extra_env),
  })

  const finish = (result: CodexProviderTestResult): CodexProviderTestResult => {
    trace('codex.providertest', 'result', result)
    return result
  }

  if (!baseUrl) {
    return finish({ success: false, models: 0, error: 'base_url is required for a Codex provider' })
  }

  const env = buildCodexProviderTestEnv(input.api_key, input.extra_env)
  const override = makeCodexProviderOverride(input.name ?? '', baseUrl)
  const cliOverrides = buildCodexProviderCliOverrides(override)
  trace('codex.providertest', 'env', {
    envKeys: Object.keys(env),
    hasCodexApiKey: Boolean(env.CODEX_API_KEY),
    cliOverrideCount: cliOverrides.length,
  })

  let handle: AppServerConnectionHandle | null = null

  try {
    try {
      handle = await runPhase((signal) => abortable(factory(env, signal, cliOverrides), signal, `connect timed out after ${PHASE_TIMEOUT_SECONDS}s`))
      trace('codex.providertest', 'connect', { ok: true })
    } catch (err) {
      const message = errMsg(err)
      trace('codex.providertest', 'connect', { ok: false, error: message })
      return finish({ success: false, models: 0, error: `app-server launch failed: ${message}` })
    }

    const connection = handle.connection

    onProgress?.({ phase: 'model_list', status: 'start' })
    let modelCount: number
    let probeModel: string
    try {
      const listed = await runPhase((signal) =>
        abortable(listProviderModels(connection), signal, `model/list timed out after ${PHASE_TIMEOUT_SECONDS}s`),
      )
      modelCount = listed.ids.length
      trace('codex.providertest', 'model_list', { ok: true, count: modelCount, defaultModel: listed.defaultModel })
      if (modelCount === 0) {
        return finish({ success: false, models: 0, error: 'model/list returned no models for this provider' })
      }
      probeModel = requestedModel || listed.defaultModel || listed.ids[0]
    } catch (err) {
      const message = errMsg(err)
      trace('codex.providertest', 'model_list', { ok: false, error: message })
      return finish({ success: false, models: 0, error: `model/list failed: ${message}` })
    }
    onProgress?.({ phase: 'model_list', status: 'ok' })

    onProgress?.({ phase: 'turn', status: 'start' })
    return finish(await runPhase(async (signal) => {
      let threadId: string
      try {
        const res = await abortable(
          connection.request(
            'thread/start',
            compactRecord({
              model: probeModel,
              model_provider: override.id,
              cwd: resolveProbeCwd(),
              approvalPolicy: 'never',
              sandbox: 'read-only',
              config: {
                developer_instructions: 'Connectivity probe. Reply with a single word. Do not use any tools.',
                model_providers: { [override.id]: override.info },
              },
              persistExtendedHistory: false,
            }),
          ),
          signal,
          `thread/start timed out after ${PHASE_TIMEOUT_SECONDS}s`,
        )
        threadId = readString(asRecord(res.thread)?.id) ?? ''
        if (!threadId) throw new Error('thread/start returned no thread id')
        trace('codex.providertest', 'thread_start', { ok: true, threadId, probeModel })
      } catch (err) {
        const message = errMsg(err)
        trace('codex.providertest', 'thread_start', { ok: false, error: message })
        return { success: false, models: modelCount, error: `thread/start failed: ${message}` }
      }

      try {
        const res = await abortable(
          connection.request(
            'turn/start',
            compactRecord({
              threadId,
              input: [{ type: 'text', text: PROBE_PROMPT, text_elements: [] }],
              model: probeModel,
              approvalPolicy: 'never',
              sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } },
            }),
          ),
          signal,
          `turn/start timed out after ${PHASE_TIMEOUT_SECONDS}s`,
        )
        const turnId = readString(asRecord(res.turn)?.id) ?? ''
        trace('codex.providertest', 'turn_start', { ok: true, turnId })
      } catch (err) {
        const message = errMsg(err)
        trace('codex.providertest', 'turn_start', { ok: false, error: message })
        return { success: false, models: modelCount, error: `turn/start failed: ${message}` }
      }

      while (!signal.aborted) {
        let note: AppServerNotification
        try {
          note = await abortable(connection.nextNotification(), signal, `turn timed out after ${PHASE_TIMEOUT_SECONDS}s`)
        } catch (err) {
          const message = errMsg(err)
          trace('codex.providertest', 'turn_drain', { ok: false, error: message })
          return { success: false, models: modelCount, error: signal.aborted ? message : `app-server closed during probe: ${message}` }
        }

        trace('codex.providertest', 'notification', { method: note.method, params: note.params })

        if (note.method === 'error') {
          const httpStatus = codexErrorHttpStatus(note.params)
          const terminal = httpStatus !== null && TERMINAL_HTTP_STATUSES.has(httpStatus)
          if (!terminal && note.params.willRetry === true) continue
          const message = pickNotificationError(note.params)
          trace('codex.providertest', 'turn_drain', { ok: false, method: note.method, httpStatus, terminal, error: message })
          return { success: false, models: modelCount, error: message }
        }

        if (note.method === 'turn/completed') {
          const status = readString(asRecord(note.params.turn)?.status) ?? 'completed'
          if (status === 'completed') {
            trace('codex.providertest', 'turn_drain', { ok: true, method: note.method, status })
            return { success: true, models: modelCount }
          }
          const message = pickNotificationError(note.params)
          trace('codex.providertest', 'turn_drain', { ok: false, method: note.method, status, error: message })
          return { success: false, models: modelCount, error: message }
        }
      }

      trace('codex.providertest', 'turn_drain', { ok: false, error: 'timeout' })
      return { success: false, models: modelCount, error: `Test timed out after ${PHASE_TIMEOUT_SECONDS}s` }
    }))
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch (err) {
        log.debug('[codex] provider test close failed: %s', errMsg(err))
      }
    }
  }
}
