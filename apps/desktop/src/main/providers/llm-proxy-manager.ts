import { fork, type ChildProcess, type ForkOptions } from 'child_process'
import { createHash } from 'crypto'
import net from 'net'
import { join } from 'path'
import log from '../logger'
import { getNodeRuntime } from '../agent/resolve-cli'
import { ProcessTitle } from '../process-titles'
import { resolveCodexChatReasoning, type CodexChatReasoningConfig } from './codex-responses/reasoning'
import { resolveChatService } from './resolver'

export interface ProxyUpstream {
  name: string
  api_base_url: string
  api_key: string
  models: string[]
  transformerUse: string[]
  reasoningConfig?: CodexChatReasoningConfig
}

interface ProxyInstance {
  port: number
  proc: ChildProcess
  ready: Promise<void>
  lastUsed: number
  upstream: ProxyUpstream
}

const PROXY_IDLE_MS = 300_000
const PROXY_READY_TIMEOUT_MS = 15_000
const SWEEP_INTERVAL_MS = 60_000

let sweepTimer: ReturnType<typeof setInterval> | null = null
const instances = new Map<string, ProxyInstance>()

function upstreamKey(u: ProxyUpstream): string {
  return createHash('sha256').update(JSON.stringify(u)).digest('hex').slice(0, 16)
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) {
        const { port } = addr
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('no address')))
      }
    })
  })
}

function resolveEntryPath(): string {
  return join(__dirname, 'llm-proxy-entry.js')
}

export function buildProxyConfig(port: number, upstream: ProxyUpstream): Record<string, unknown> {
  const { transformerUse, reasoningConfig, ...provider } = upstream
  return {
    PORT: port,
    HOST: '127.0.0.1',
    ...(reasoningConfig ? { superoneReasoningConfig: reasoningConfig } : {}),
    providers: [{ ...provider, transformer: { use: transformerUse } }],
  }
}

export function buildProxyEnv(config: Record<string, unknown>, runtimeEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...runtimeEnv,
    SUPERONE_PROXY_CONFIG: JSON.stringify(config),
    SUPERONE_EVENT_TRACE_CHILD: '1',
    SUPERONE_EVENT_TRACE_DB: join(process.cwd(), 'llm-proxy-event-trace.db'),
  }
}

function startSweepIfNeeded(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, inst] of instances) {
      if (now - inst.lastUsed > PROXY_IDLE_MS) {
        log.info('[llm-proxy] sweep idle instance key=%s port=%d', key, inst.port)
        inst.proc.kill()
        instances.delete(key)
      }
    }
    if (instances.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
}

// `argv0` is forwarded to the underlying `spawn()` at runtime (fork() just spreads
// its options through), but @types/node's `ForkOptions` omits it — cast to add it.
type ForkOptionsWithArgv0 = ForkOptions & { argv0?: string }

function spawnChild(port: number, upstream: ProxyUpstream): ChildProcess {
  const entryPath = resolveEntryPath()
  const runtime = getNodeRuntime('llm-proxy')
  const config = buildProxyConfig(port, upstream)
  const env = buildProxyEnv(config, runtime.env)
  const opts: ForkOptionsWithArgv0 = {
    argv0: ProcessTitle.LlmProxy,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    ...(runtime.executable ? { execPath: runtime.executable } : {}),
  }
  return fork(entryPath, [], opts)
}

function waitForReady(proc: ChildProcess, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`proxy entry did not become ready within ${PROXY_READY_TIMEOUT_MS}ms`))
    }, PROXY_READY_TIMEOUT_MS)

    proc.on('message', (msg) => {
      if (msg && typeof msg === 'object' && 'type' in msg && msg.type === 'listening') {
        clearTimeout(timeout)
        resolve()
      }
    })

    let pollCount = 0
    const poll = () => {
      if (pollCount++ > 20) return
      const socket = net.createConnection(port, '127.0.0.1', () => {
        socket.destroy()
        clearTimeout(timeout)
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        setTimeout(poll, 300)
      })
    }
    poll()

    proc.stderr?.on('data', (chunk: Buffer) => {
      log.warn('[llm-proxy] stderr: %s', chunk.toString().trim())
    })

    proc.on('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`proxy entry exited code=${code} signal=${signal} before ready`))
    })
  })
}

export async function ensureProxy(upstream: ProxyUpstream): Promise<{ url: string; port: number }> {
  const key = upstreamKey(upstream)
  const existing = instances.get(key)
  if (existing) {
    existing.lastUsed = Date.now()
    await existing.ready
    return { url: `http://127.0.0.1:${existing.port}`, port: existing.port }
  }

  const port = await getFreePort()
  const proc = spawnChild(port, upstream)
  const ready = waitForReady(proc, port)

  const inst: ProxyInstance = { port, proc, ready, lastUsed: Date.now(), upstream }
  instances.set(key, inst)
  startSweepIfNeeded()

  proc.on('exit', (code, signal) => {
    const current = instances.get(key)
    if (current && current.proc === proc) {
      const recentlyUsed = Date.now() - current.lastUsed < PROXY_IDLE_MS
      if (recentlyUsed) {
        log.warn('[llm-proxy] unexpected exit key=%s code=%s signal=%s, restarting on same port', key, code, signal)
        const restarted = spawnChild(port, upstream)
        const newReady = waitForReady(restarted, port)
        current.proc = restarted
        current.ready = newReady
      } else {
        instances.delete(key)
      }
    }
  })

  await ready
  log.info('[llm-proxy] instance ready key=%s port=%d', key, port)
  return { url: `http://127.0.0.1:${port}`, port }
}

export function shutdownAll(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  for (const [key, inst] of instances) {
    log.info('[llm-proxy] shutdown key=%s port=%d', key, inst.port)
    inst.proc.kill()
  }
  instances.clear()
}

const codexProxyCache = new Map<string, string>()

function codexProxyCacheKey(apiProviderId?: string | null): string {
  return resolveChatService('codex', apiProviderId ?? null)?.credentialId ?? apiProviderId ?? ''
}

export function getCodexProxyUrl(apiProviderId: string | null): string | undefined {
  return codexProxyCache.get(codexProxyCacheKey(apiProviderId))
}

export function clearCodexProxyCache(): void {
  codexProxyCache.clear()
}

export async function ensureCodexProxyUrl(apiProviderId?: string | null): Promise<string | undefined> {
  const key = codexProxyCacheKey(apiProviderId)
  const cached = codexProxyCache.get(key)
  if (cached) return cached

  const resolved = resolveChatService('codex', apiProviderId ?? null)
  if (!resolved || resolved.protocol !== 'openai-chat') return undefined

  const apiBase = resolved.baseUrl.replace(/\/$/, '')
  const modelMapping = resolved.modelMapping ?? {}

  const upstream: ProxyUpstream = {
    name: resolved.brand,
    api_base_url: `${apiBase}/chat/completions`,
    api_key: resolved.apiKey,
    models: Object.values(modelMapping).map((s) => s?.id?.replace(/\[1m\]/i, '')).filter(Boolean) as string[],
    transformerUse: [],
    reasoningConfig: resolveCodexChatReasoning(resolved.platformId),
  }

  const { url } = await ensureProxy(upstream)
  codexProxyCache.set(key, url)
  return url
}
