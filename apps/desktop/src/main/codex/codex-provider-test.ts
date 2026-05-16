import log from '../logger'
import { trace } from '../agent/event-trace'
import { resolveProbeCwd } from '../agent/probe-cwd'
import {
  asRecord,
  buildCodexProviderTestEnv,
  compactRecord,
  createAppServerConnection,
  makeCodexProviderOverride,
  readString,
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
) => Promise<AppServerConnectionHandle>

const TEST_TIMEOUT_MS = 20_000
const PROBE_PROMPT = 'Reply with "ok" only.'

const defaultFactory: CodexTestConnectionFactory = (env, signal) =>
  createAppServerConnection({ mode: 'apiKey' }, signal, env)

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

function pickNotificationError(params: Record<string, unknown>): string {
  const direct = readString(params.message)
  if (direct) return direct
  const nested = asRecord(params.error)
  const nestedMsg = nested ? readString(nested.message) : null
  if (nestedMsg) return nestedMsg
  const turn = asRecord(params.turn)
  const turnErr = turn ? asRecord(turn.error) : null
  const turnMsg = turnErr ? readString(turnErr.message) : null
  return turnMsg ?? 'Codex turn failed'
}

export async function testCodexProvider(
  input: CodexProviderTestInput,
  factory: CodexTestConnectionFactory = defaultFactory,
): Promise<CodexProviderTestResult> {
  const baseUrl = input.base_url?.trim() ?? ''
  const model = input.model?.trim() || 'gpt-5'

  trace('codex.providertest', 'start', {
    hasKey: Boolean(input.api_key),
    baseUrl: baseUrl ? safeHost(baseUrl) : '',
    model,
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
  trace('codex.providertest', 'env', {
    envKeys: Object.keys(env),
    hasCodexApiKey: Boolean(env.CODEX_API_KEY),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  let handle: AppServerConnectionHandle | null = null

  try {
    try {
      handle = await factory(env, controller.signal)
      trace('codex.providertest', 'connect', { ok: true })
    } catch (err) {
      const message = errMsg(err)
      trace('codex.providertest', 'connect', { ok: false, error: message })
      return finish({ success: false, models: 0, error: `app-server launch failed: ${message}` })
    }

    const connection = handle.connection

    let threadId: string
    try {
      const res = await connection.request(
        'thread/start',
        compactRecord({
          model,
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
      )
      threadId = readString(asRecord(res.thread)?.id) ?? ''
      if (!threadId) throw new Error('thread/start returned no thread id')
      trace('codex.providertest', 'thread_start', { ok: true, threadId })
    } catch (err) {
      const message = errMsg(err)
      trace('codex.providertest', 'thread_start', { ok: false, error: message })
      return finish({ success: false, models: 0, error: `thread/start failed: ${message}` })
    }

    try {
      const res = await connection.request(
        'turn/start',
        compactRecord({
          threadId,
          input: [{ type: 'text', text: PROBE_PROMPT, text_elements: [] }],
          model,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } },
        }),
      )
      const turnId = readString(asRecord(res.turn)?.id) ?? ''
      trace('codex.providertest', 'turn_start', { ok: true, turnId })
    } catch (err) {
      const message = errMsg(err)
      trace('codex.providertest', 'turn_start', { ok: false, error: message })
      return finish({ success: false, models: 0, error: `turn/start failed: ${message}` })
    }

    while (!controller.signal.aborted) {
      let note: AppServerNotification
      try {
        note = await connection.nextNotification()
      } catch (err) {
        if (controller.signal.aborted) break
        const message = errMsg(err)
        trace('codex.providertest', 'turn_drain', { ok: false, error: message })
        return finish({ success: false, models: 0, error: `app-server closed during probe: ${message}` })
      }

      if (note.method === 'error') {
        if (note.params.willRetry === true) continue
        const message = pickNotificationError(note.params)
        trace('codex.providertest', 'turn_drain', { ok: false, method: note.method, error: message })
        return finish({ success: false, models: 0, error: message })
      }

      if (note.method === 'turn/completed') {
        const status = readString(asRecord(note.params.turn)?.status) ?? 'completed'
        if (status === 'completed') {
          trace('codex.providertest', 'turn_drain', { ok: true, method: note.method, status })
          return finish({ success: true, models: 0 })
        }
        const message = pickNotificationError(note.params)
        trace('codex.providertest', 'turn_drain', { ok: false, method: note.method, status, error: message })
        return finish({ success: false, models: 0, error: message })
      }

      if (note.method.startsWith('item/')) {
        trace('codex.providertest', 'turn_drain', { ok: true, method: note.method })
        return finish({ success: true, models: 0 })
      }
    }

    trace('codex.providertest', 'turn_drain', { ok: false, error: 'timeout' })
    return finish({ success: false, models: 0, error: `Test timed out after ${TEST_TIMEOUT_MS / 1000}s` })
  } finally {
    clearTimeout(timer)
    if (handle) {
      try {
        await handle.close()
      } catch (err) {
        log.debug('[codex] provider test close failed: %s', errMsg(err))
      }
    }
  }
}
