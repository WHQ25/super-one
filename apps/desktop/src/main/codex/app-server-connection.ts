import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { createRequire } from 'module'
import { createInterface } from 'readline'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { getNodeRuntime } from '../agent/resolve-cli'
import { getActiveProviderRaw } from '../database'
import { ProcessTitle } from '../process-titles'
import {
  CODEX_PERMISSION_PRESETS,
  DEFAULT_CODEX_PERMISSION_PRESET,
  DEFAULT_CODEX_PERMISSION_PROFILE,
} from '@superone/shared/agent-types'
import type {
  CodexApprovalMode,
  CodexAuthMode,
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  CodexSandboxMode,
  ModelOption,
  ReasoningEffortOption,
} from '@superone/shared/agent-types'

export const APP_SERVER_RESPONSE_TIMEOUT_MS = 15_000

const moduleRequire = createRequire(import.meta.url)
let cachedCodexCliScriptPath: string | null = null

export interface CodexProjectAuth {
  mode: CodexAuthMode
  apiKey?: string
}

export type JsonRpcRequestId = string | number

export interface AppServerNotification {
  requestIdRaw?: JsonRpcRequestId
  requestId?: string
  method: string
  params: Record<string, unknown>
}

export interface AppServerConnection {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  respond(requestId: JsonRpcRequestId, result?: Record<string, unknown>): Promise<void>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  nextNotification(): Promise<AppServerNotification>
  pollNotification?(timeoutMs: number): Promise<AppServerNotification | null>
}

export interface AppServerExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
}

export interface AppServerConnectionHandle {
  connection: AppServerConnection
  close(): Promise<void>
  getStderr(): string
  onClosed(cb: (info: AppServerExitInfo) => void): () => void
}

export interface CodexAppServerModel {
  id: string
  model: string
  displayName: string
  description: string
  isDefault: boolean
  supportedReasoningEfforts: ReasoningEffortOption[]
  defaultReasoningEffort?: CodexReasoningEffort
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function extractJsonRpcErrorMessage(raw: unknown): string {
  const rec = asRecord(raw)
  if (!rec) return 'Unknown app-server error'
  return readString(rec.message) ?? 'Unknown app-server error'
}

export function normalizeApiKey(value?: string): string | undefined {
  const key = value?.trim()
  return key ? key : undefined
}

export function resolveApiKey(mode: CodexAuthMode, sessionApiKey?: string): string | undefined {
  if (mode === 'chatgpt') return undefined
  if (mode === 'apiKey') return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
  return normalizeApiKey(sessionApiKey) ?? normalizeApiKey(process.env.CODEX_API_KEY)
}

export function resolveMode(mode: CodexAuthMode, sessionApiKey?: string): 'chatgpt' | 'apiKey' {
  return resolveApiKey(mode, sessionApiKey) ? 'apiKey' : 'chatgpt'
}

export function resolveCodexPlatformPackage(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'darwin' && arch === 'x64') return '@openai/codex-darwin-x64'
  if (platform === 'darwin' && arch === 'arm64') return '@openai/codex-darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return '@openai/codex-linux-x64'
  if (platform === 'linux' && arch === 'arm64') return '@openai/codex-linux-arm64'
  if (platform === 'win32' && arch === 'x64') return '@openai/codex-win32-x64'
  if (platform === 'win32' && arch === 'arm64') return '@openai/codex-win32-arm64'
  return null
}

export function hasCodexPlatformPackage(packageName: string): boolean {
  try {
    moduleRequire.resolve(`${packageName}/package.json`)
    return true
  } catch {
    return false
  }
}

export function findSystemCodexCli(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which'
  try {
    const out = execFileSync(cmd, ['codex'], { timeout: 3000, stdio: 'pipe' }).toString()
    const candidate = out.split(/\r?\n/).map((v) => v.trim()).find(Boolean)
    return candidate ?? null
  } catch {
    return null
  }
}

export function resolveCodexCliScriptPath(): string {
  if (cachedCodexCliScriptPath) return cachedCodexCliScriptPath
  let resolved = moduleRequire.resolve('@openai/codex/bin/codex.js')
  resolved = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  log.info('[codex] Resolved CLI script:', resolved)
  cachedCodexCliScriptPath = resolved
  return cachedCodexCliScriptPath
}

export function buildAppServerEnv(auth: CodexProjectAuth): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  const codexProvider = getActiveProviderRaw('codex')
  if (codexProvider) {
    const configs = JSON.parse(codexProvider.agent_configs || '{}')
    const cc = configs.codex
    if (codexProvider.api_key) env.CODEX_API_KEY = codexProvider.api_key
    if (cc?.base_url) env.OPENAI_BASE_URL = cc.base_url
    try { Object.assign(env, JSON.parse(cc?.extra_env || '{}')) } catch {}
    return env
  }
  if (auth.mode === 'chatgpt') {
    delete env.CODEX_API_KEY
    return env
  }
  const apiKey = resolveApiKey(auth.mode, auth.apiKey)
  if (apiKey) env.CODEX_API_KEY = apiKey
  return env
}

export function mapAppServerModel(m: CodexAppServerModel): ModelOption {
  return {
    id: m.model,
    name: m.displayName || m.model,
    description: m.description,
    isDefault: m.isDefault,
    supportedReasoningEfforts: m.supportedReasoningEfforts,
    defaultReasoningEffort: m.defaultReasoningEffort,
  }
}

export function resolvePermissionProfile(
  permissionPreset?: CodexPermissionPreset,
): {
  permissionPreset: CodexPermissionPreset
  approvalPolicy: CodexApprovalMode
  sandboxMode: CodexSandboxMode
  networkAccessEnabled: boolean
} {
  const resolvedPreset = permissionPreset ?? DEFAULT_CODEX_PERMISSION_PRESET
  const profile = CODEX_PERMISSION_PRESETS[resolvedPreset] ?? DEFAULT_CODEX_PERMISSION_PROFILE
  return {
    permissionPreset: resolvedPreset,
    approvalPolicy: profile.approvalPolicy,
    sandboxMode: profile.sandboxMode,
    networkAccessEnabled: profile.networkAccessEnabled,
  }
}

export function buildCollaborationMode(
  collaborationMode: CodexCollaborationMode | undefined,
  model?: string,
  reasoningEffort?: CodexReasoningEffort,
): Record<string, unknown> | undefined {
  if (!collaborationMode || !model) return undefined
  return {
    mode: collaborationMode,
    settings: {
      model,
      reasoning_effort: reasoningEffort ?? null,
      developer_instructions: null,
    },
  }
}

export async function createAppServerConnection(
  auth: CodexProjectAuth,
  signal?: AbortSignal,
): Promise<AppServerConnectionHandle> {
  if (signal?.aborted) {
    throw new Error('Codex run interrupted')
  }

  const codexScript = resolveCodexCliScriptPath()
  const env = buildAppServerEnv(auth)
  const expectedPackage = resolveCodexPlatformPackage()
  const hasBundledPackage = expectedPackage ? hasCodexPlatformPackage(expectedPackage) : false
  const systemCodexCli = !hasBundledPackage ? findSystemCodexCli() : null
  log.info(
    '[codex] app-server launch platform=%s arch=%s mode=%s script=%s expectedPackage=%s bundledPackage=%s systemCodex=%s',
    process.platform,
    process.arch,
    auth.mode,
    codexScript,
    expectedPackage ?? 'unknown',
    hasBundledPackage,
    systemCodexCli ?? 'none',
  )

  if (!hasBundledPackage && !systemCodexCli) {
    const hint = process.platform === 'darwin'
      ? 'Rebuild dependencies with: bun install --frozen-lockfile --os=darwin --cpu=*'
      : 'Rebuild dependencies for the current target architecture'
    throw new Error(`Missing Codex runtime package (${expectedPackage ?? 'unknown'}). ${hint}`)
  }

  const child: ChildProcess = systemCodexCli
    ? spawn(systemCodexCli, ['app-server', '--listen', 'stdio://'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: true,
        argv0: ProcessTitle.Codex,
      })
    : spawn(getNodeRuntime().executable ?? process.execPath, [codexScript, 'app-server', '--listen', 'stdio://'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        argv0: ProcessTitle.Codex,
      })

  const stdout = child.stdout
  const stdin = child.stdin
  if (!stdout || !stdin) {
    child.kill()
    throw new Error('Failed to start Codex app-server')
  }

  const rl = createInterface({ input: stdout })
  const iterator = rl[Symbol.asyncIterator]()
  const stderrChunks: string[] = []
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => stderrChunks.push(chunk))

  const onAbort = () => {
    if (!child.killed) child.kill()
  }
  signal?.addEventListener('abort', onAbort)

  const closedListeners = new Set<(info: AppServerExitInfo) => void>()
  let exitInfo: AppServerExitInfo | null = null
  child.on('exit', (code, sigName) => {
    exitInfo = { code, signal: sigName, stderr: stderrChunks.join('') }
    for (const cb of closedListeners) {
      try { cb(exitInfo) } catch (err) { log.warn('[codex] onClosed listener error:', err) }
    }
  })

  const sendMessage = async (payload: Record<string, unknown>): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  const readMessage = async (): Promise<Record<string, unknown>> => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const next = await iterator.next()
      if (next.done) {
        throw new Error('Codex app-server closed unexpectedly')
      }
      const line = `${next.value}`.trim()
      if (!line) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const rec = asRecord(parsed)
      if (rec) return rec
    }
  }

  interface ResponseWaiter {
    resolve: (value: Record<string, unknown>) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }

  const responseWaiters = new Map<string, ResponseWaiter>()
  const notificationQueue: AppServerNotification[] = []
  const notificationWaiters: Array<(n: AppServerNotification | null, err?: Error) => void> = []
  let readerError: Error | null = null
  let nextRequestId = 1

  const rejectAllWaiters = (err: Error): void => {
    for (const waiter of responseWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    responseWaiters.clear()
    while (notificationWaiters.length > 0) {
      const waiter = notificationWaiters.shift()
      waiter?.(null, err)
    }
  }

  const dispatchNotification = (notif: AppServerNotification): void => {
    const waiter = notificationWaiters.shift()
    if (waiter) waiter(notif)
    else notificationQueue.push(notif)
  }

  void (async () => {
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const msg = await readMessage()
        const method = readString(msg.method)
        const rawId = ('id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number'))
          ? (msg.id as JsonRpcRequestId)
          : undefined

        if (method) {
          dispatchNotification({
            requestIdRaw: rawId,
            requestId: rawId !== undefined ? String(rawId) : undefined,
            method,
            params: asRecord(msg.params) ?? {},
          })
          continue
        }

        if (rawId === undefined) continue
        const key = String(rawId)
        const waiter = responseWaiters.get(key)
        if (!waiter) continue
        responseWaiters.delete(key)
        clearTimeout(waiter.timer)
        if ('error' in msg && msg.error) {
          waiter.reject(new Error(extractJsonRpcErrorMessage(msg.error)))
        } else {
          waiter.resolve(asRecord(msg.result) ?? {})
        }
      }
    } catch (err) {
      readerError = err instanceof Error ? err : new Error(String(err))
      rejectAllWaiters(readerError)
    }
  })()

  const waitForResponse = (id: number, label: string): Promise<Record<string, unknown>> => {
    if (readerError) return Promise.reject(readerError)
    const key = String(id)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        responseWaiters.delete(key)
        reject(new Error(`Codex app-server ${label} timed out after ${APP_SERVER_RESPONSE_TIMEOUT_MS}ms`))
      }, APP_SERVER_RESPONSE_TIMEOUT_MS)
      responseWaiters.set(key, { resolve, reject, timer })
    })
  }

  const isDev = process.env.NODE_ENV === 'development'

  const connection: AppServerConnection = {
    request: async (method, params) => {
      const requestId = nextRequestId
      nextRequestId += 1
      if (isDev) trace('codex.appserver.request', method, { requestId, params }, String(requestId))
      await sendMessage(compactRecord({ id: requestId, method, params }))
      try {
        const result = await waitForResponse(requestId, method)
        if (isDev) trace('codex.appserver.response', method, { requestId, ok: true, result }, String(requestId))
        return result
      } catch (err) {
        if (isDev) trace('codex.appserver.response', method, { requestId, ok: false, error: (err as Error).message }, String(requestId))
        throw err
      }
    },

    respond: async (requestId, result) => {
      if (isDev) trace('codex.appserver.respond', 'client_response', { requestId, result }, String(requestId))
      await sendMessage(compactRecord({ id: requestId, result: result ?? {} }))
    },

    notify: async (method, params) => {
      if (isDev) trace('codex.appserver.notify', method, { params })
      await sendMessage(compactRecord({ method, params }))
    },

    nextNotification: async () => {
      const queued = notificationQueue.shift()
      if (queued) return queued
      if (readerError) throw readerError
      return new Promise<AppServerNotification>((resolve, reject) => {
        notificationWaiters.push((notif, err) => {
          if (err) reject(err)
          else if (notif) resolve(notif)
          else reject(new Error('Codex app-server connection closed'))
        })
      })
    },

    pollNotification: async (timeoutMs) => {
      const queued = notificationQueue.shift()
      if (queued) return queued
      if (readerError) throw readerError
      return new Promise<AppServerNotification | null>((resolve, reject) => {
        let settled = false
        let waiter: (n: AppServerNotification | null, err?: Error) => void
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          const idx = notificationWaiters.indexOf(waiter)
          if (idx >= 0) notificationWaiters.splice(idx, 1)
          resolve(null)
        }, Math.max(0, timeoutMs))
        waiter = (notif, err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (err) reject(err)
          else resolve(notif)
        }
        notificationWaiters.push(waiter)
      })
    },
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    signal?.removeEventListener('abort', onAbort)
    rl.close()
    try {
      stdin.end()
    } catch {
      // ignore
    }
    if (!child.killed) child.kill()
  }

  try {
    await connection.request('initialize', {
      clientInfo: {
        name: 'super-one',
        title: 'Super One',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    await connection.notify('initialized')
  } catch (error) {
    const stderr = stderrChunks.join('').trim()
    log.error('[codex] app-server error:', error instanceof Error ? error.message : String(error))
    if (stderr.includes('Missing optional dependency')) {
      log.error(
        '[codex] missing optional dependency detected platform=%s arch=%s expectedPackage=%s',
        process.platform,
        process.arch,
        expectedPackage ?? 'unknown',
      )
    }
    if (stderr) log.error('[codex] app-server stderr:', stderr)
    await close()
    if (stderr) {
      const message = error instanceof Error ? error.message : String(error)
      const debugLogPath = String(log.transports.file.getFile().path)
      throw new Error(`${message}\n${stderr}\nDebug log: ${debugLogPath}`)
    }
    throw error
  }

  return {
    connection,
    close,
    getStderr: () => stderrChunks.join(''),
    onClosed: (cb) => {
      closedListeners.add(cb)
      if (exitInfo) {
        try { cb(exitInfo) } catch (err) { log.warn('[codex] onClosed replay error:', err) }
      }
      return () => { closedListeners.delete(cb) }
    },
  }
}
