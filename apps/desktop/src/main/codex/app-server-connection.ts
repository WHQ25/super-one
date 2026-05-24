import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { createRequire } from 'module'
import { createInterface } from 'readline'
import log from '../logger'
import { trace } from '../agent/event-trace'
import { SUPERONE_SYSTEM_PROMPT_APPEND } from '../agent/superone-system-prompt'
import { getActiveProviderRaw, getProviderByIdRaw } from '../database'
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

export const APP_SERVER_BACKPRESSURE_CODE = -32001
export const APP_SERVER_BACKPRESSURE_MAX_ATTEMPTS = 3
export const APP_SERVER_BACKPRESSURE_BASE_DELAY_MS = 100

export const APP_SERVER_IDEMPOTENT_METHODS = new Set<string>([
  'model/list',
  'permissionProfile/list',
  'experimentalFeature/list',
  'thread/list',
  'thread/read',
  'thread/loaded/list',
  'skills/list',
  'hooks/list',
  'plugin/list',
  'plugin/installed',
  'plugin/read',
  'mcpServerStatus/list',
  'config/read',
])

export const APP_SERVER_OPT_OUT_NOTIFICATIONS: readonly string[] = []

export class JsonRpcError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
  }
}

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

export function extractJsonRpcError(raw: unknown): JsonRpcError {
  const rec = asRecord(raw)
  const code = typeof rec?.code === 'number' ? rec.code : 0
  const message = readString(rec?.message) ?? 'Unknown app-server error'
  return new JsonRpcError(code, message)
}

export function extractJsonRpcErrorMessage(raw: unknown): string {
  return extractJsonRpcError(raw).message
}

function jitter(maxMs: number): number {
  return Math.floor(Math.random() * maxMs)
}

function isBackpressureError(err: unknown): boolean {
  return err instanceof JsonRpcError && err.code === APP_SERVER_BACKPRESSURE_CODE
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

const CODEX_TARGET_TRIPLE_BY_PLATFORM: Record<string, string | undefined> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

export function resolveCodexTargetTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  return CODEX_TARGET_TRIPLE_BY_PLATFORM[`${platform}-${arch}`] ?? null
}

export interface CodexNativeBinary {
  binaryPath: string
  pathDir: string
}

const cachedCodexNativeBinary = new Map<string, CodexNativeBinary>()

export function resolveCodexNativeBinary(packageName: string): CodexNativeBinary | null {
  const cached = cachedCodexNativeBinary.get(packageName)
  if (cached) return cached
  const target = resolveCodexTargetTriple()
  if (!target) return null
  let pkgJsonPath: string
  try {
    pkgJsonPath = moduleRequire.resolve(`${packageName}/package.json`)
  } catch {
    return null
  }
  const unpacked = pkgJsonPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
  const pkgRoot = unpacked.slice(0, unpacked.lastIndexOf('/package.json'))
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const resolved: CodexNativeBinary = {
    binaryPath: `${pkgRoot}/vendor/${target}/bin/${binaryName}`,
    pathDir: `${pkgRoot}/vendor/${target}/codex-path`,
  }
  log.info('[codex] Resolved native binary:', resolved.binaryPath)
  cachedCodexNativeBinary.set(packageName, resolved)
  return resolved
}

function prependPath(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':'
  const existing = env.PATH ?? process.env.PATH ?? ''
  return { ...env, PATH: existing ? `${dir}${sep}${existing}` : dir }
}

export const SUPERONE_CODEX_PROVIDER_ID = 'superone_custom'

export interface CodexProviderOverride {
  id: string
  info: Record<string, unknown>
}

interface CodexProviderConfig {
  base_url?: string
  extra_env?: string
}

function parseCodexProviderConfig(agentConfigs: string | null | undefined): CodexProviderConfig | undefined {
  try {
    return (JSON.parse(agentConfigs || '{}') as { codex?: CodexProviderConfig }).codex
  } catch {
    return undefined
  }
}

export function makeCodexProviderOverride(name: string, baseUrl: string): CodexProviderOverride {
  return {
    id: SUPERONE_CODEX_PROVIDER_ID,
    info: {
      name: name || 'SuperOne Custom',
      base_url: baseUrl,
      env_key: 'CODEX_API_KEY',
      wire_api: 'responses',
      requires_openai_auth: false,
    },
  }
}

function tomlOverrideValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

export function buildCodexProviderCliOverrides(override: CodexProviderOverride | null): string[] {
  if (!override) return []
  const args: string[] = ['-c', `model_provider=${override.id}`]
  for (const [key, value] of Object.entries(override.info)) {
    if (value === undefined || value === null) continue
    args.push('-c', `model_providers.${override.id}.${key}=${tomlOverrideValue(value)}`)
  }
  return args
}

function resolveCodexProviderRow(apiProviderId?: string | null) {
  if (apiProviderId) {
    const explicit = getProviderByIdRaw(apiProviderId)
    if (explicit) return explicit
  }
  return getActiveProviderRaw('codex')
}

export function getCodexProviderOverrideFor(apiProviderId?: string | null): CodexProviderOverride | null {
  const codexProvider = resolveCodexProviderRow(apiProviderId)
  if (!codexProvider) return null
  const baseUrl = parseCodexProviderConfig(codexProvider.agent_configs)?.base_url?.trim()
  if (!baseUrl) return null
  return makeCodexProviderOverride(codexProvider.name, baseUrl)
}

export function getCodexProviderOverride(): CodexProviderOverride | null {
  return getCodexProviderOverrideFor(null)
}

const CODEX_TEST_SYSTEM_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'USERPROFILE', 'PROGRAMDATA', 'COMSPEC']

export function buildCodexProviderTestEnv(apiKey: string, extraEnv: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of CODEX_TEST_SYSTEM_ENV_ALLOWLIST) {
    const v = process.env[key]
    if (v !== undefined) env[key] = v
  }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
  if (apiKey) env.CODEX_API_KEY = apiKey
  try { Object.assign(env, JSON.parse(extraEnv || '{}')) } catch { /* ignore malformed extra_env */ }
  return env
}

export function buildAppServerEnv(auth: CodexProjectAuth, apiProviderId?: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  const codexProvider = resolveCodexProviderRow(apiProviderId)
  if (codexProvider) {
    const cc = parseCodexProviderConfig(codexProvider.agent_configs)
    if (codexProvider.api_key) env.CODEX_API_KEY = codexProvider.api_key
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
      developer_instructions: SUPERONE_SYSTEM_PROMPT_APPEND,
    },
  }
}

export async function createAppServerConnection(
  auth: CodexProjectAuth,
  signal?: AbortSignal,
  envOverride?: NodeJS.ProcessEnv,
  cliOverrides?: string[],
  apiProviderId?: string | null,
): Promise<AppServerConnectionHandle> {
  if (signal?.aborted) {
    throw new Error('Codex run interrupted')
  }

  const baseEnv = envOverride ?? buildAppServerEnv(auth, apiProviderId)
  const overrideArgs = cliOverrides ?? buildCodexProviderCliOverrides(getCodexProviderOverrideFor(apiProviderId))
  const expectedPackage = resolveCodexPlatformPackage()
  const hasBundledPackage = expectedPackage ? hasCodexPlatformPackage(expectedPackage) : false
  const bundledBinary = hasBundledPackage && expectedPackage ? resolveCodexNativeBinary(expectedPackage) : null
  const systemCodexCli = !bundledBinary ? findSystemCodexCli() : null
  log.info(
    '[codex] app-server launch platform=%s arch=%s mode=%s expectedPackage=%s bundledBinary=%s systemCodex=%s',
    process.platform,
    process.arch,
    auth.mode,
    expectedPackage ?? 'unknown',
    bundledBinary?.binaryPath ?? 'none',
    systemCodexCli ?? 'none',
  )

  if (!bundledBinary && !systemCodexCli) {
    const hint = process.platform === 'darwin'
      ? 'Rebuild dependencies with: bun install --frozen-lockfile --os=darwin --cpu=*'
      : 'Rebuild dependencies for the current target architecture'
    throw new Error(`Missing Codex runtime package (${expectedPackage ?? 'unknown'}). ${hint}`)
  }

  const spawnArgs = [...overrideArgs, 'app-server', '--listen', 'stdio://']
  const spawnExe = bundledBinary?.binaryPath ?? systemCodexCli!
  const env = bundledBinary ? prependPath(baseEnv, bundledBinary.pathDir) : baseEnv
  const child: ChildProcess = spawn(spawnExe, spawnArgs, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && !!systemCodexCli,
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

        if (process.env.NODE_ENV === 'development') {
          const kind = method
            ? (rawId !== undefined ? 'request' : 'notification')
            : ('error' in msg && msg.error ? 'error' : 'response')
          trace(
            'codex.wire',
            method ?? `${kind}:${rawId ?? 'unknown'}`,
            { kind, ...msg },
            rawId !== undefined ? String(rawId) : undefined,
          )
        }

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
          waiter.reject(extractJsonRpcError(msg.error))
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

  const sendOnce = async (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
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
  }

  const connection: AppServerConnection = {
    request: async (method, params) => {
      if (!APP_SERVER_IDEMPOTENT_METHODS.has(method)) {
        return sendOnce(method, params)
      }
      let lastError: unknown
      for (let attempt = 0; attempt < APP_SERVER_BACKPRESSURE_MAX_ATTEMPTS; attempt += 1) {
        try {
          return await sendOnce(method, params)
        } catch (err) {
          lastError = err
          if (!isBackpressureError(err) || attempt === APP_SERVER_BACKPRESSURE_MAX_ATTEMPTS - 1) throw err
          const delay = APP_SERVER_BACKPRESSURE_BASE_DELAY_MS * 3 ** attempt + jitter(50)
          if (isDev) trace('codex.appserver.retry', method, { attempt: attempt + 1, delay }, undefined)
          await new Promise<void>((resolve) => setTimeout(resolve, delay))
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
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
    const initResult = await connection.request('initialize', {
      clientInfo: {
        name: 'super-one',
        title: 'Super One',
        version: '0.1.0',
      },
      capabilities: compactRecord({
        experimentalApi: true,
        optOutNotificationMethods: APP_SERVER_OPT_OUT_NOTIFICATIONS.length > 0
          ? [...APP_SERVER_OPT_OUT_NOTIFICATIONS]
          : undefined,
      }),
    })
    log.info(
      '[codex] app-server initialized userAgent=%s codexHome=%s platform=%s/%s',
      readString(initResult.userAgent) ?? 'unknown',
      readString(initResult.codexHome) ?? 'unknown',
      readString(initResult.platformFamily) ?? 'unknown',
      readString(initResult.platformOs) ?? 'unknown',
    )
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
