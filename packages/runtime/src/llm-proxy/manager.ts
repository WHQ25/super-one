/**
 * Electron-free LLM protocol proxy manager for headless node / CLI.
 *
 * Starts (and reuses) an in-process loopback proxy that converts:
 * - Anthropic Messages ↔ OpenAI Chat Completions (Claude harness)
 * - OpenAI Responses ↔ OpenAI Chat Completions (Codex harness)
 *
 * ## Desktop vs node
 *
 * This package is the **node / CLI** proxy (`ensureProxy` in-process loopback).
 * The desktop Electron app keeps a **separate** child-process proxy under
 * `apps/desktop/src/main/providers/llm-proxy-manager.ts` (spawned via
 * `llm-proxy-entry.ts`). Do not unify them here: desktop needs process
 * isolation + Event Trace; node needs zero Electron deps and co-located
 * lifecycle with harness turns. Protocol transformers may be shared later
 * by importing from this package into desktop — process lifecycle stays split.
 *
 * Inbound auth: callers must present `PROXY_HARNESS_API_KEY` (`sk-superone-proxy`)
 * as Bearer / x-api-key. Harness env already injects that key via
 * `buildHarnessEnvWithProxy`; the real upstream secret stays inside the proxy.
 */

import { createHash } from 'node:crypto'
import net from 'node:net'
import { startLlmProxyServer, type LlmProxyServer } from './server'
import type { ProxyHandle, ProxyUpstream } from './types'

export type { ProxyHandle, ProxyUpstream }

const PROXY_IDLE_MS = 300_000
const SWEEP_INTERVAL_MS = 60_000

interface ProxyInstance {
  port: number
  server: LlmProxyServer
  lastUsed: number
  upstream: ProxyUpstream
}

let sweepTimer: ReturnType<typeof setInterval> | null = null
const instances = new Map<string, ProxyInstance>()

function upstreamKey(u: ProxyUpstream): string {
  return createHash('sha256').update(JSON.stringify(u)).digest('hex').slice(0, 16)
}

export async function getFreePort(): Promise<number> {
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

/** Build the config object used by desktop's child-process proxy (parity helper). */
export function buildProxyConfig(port: number, upstream: ProxyUpstream): Record<string, unknown> {
  const { transformerUse, reasoningConfig, ...provider } = upstream
  return {
    PORT: port,
    HOST: '127.0.0.1',
    ...(reasoningConfig ? { superoneReasoningConfig: reasoningConfig } : {}),
    providers: [{ ...provider, transformer: { use: transformerUse } }],
  }
}

function startSweepIfNeeded(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, inst] of instances) {
      if (now - inst.lastUsed > PROXY_IDLE_MS) {
        void inst.server.close().catch(() => undefined)
        instances.delete(key)
      }
    }
    if (instances.size === 0 && sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep the process alive solely for the idle sweeper.
  sweepTimer.unref?.()
}

/** In-flight ensureProxy calls keyed by upstream — singleflight against races. */
const pendingEnsure = new Map<string, Promise<ProxyHandle>>()

/**
 * Ensure a loopback proxy is running for the given upstream.
 * Returns `http://127.0.0.1:<port>` suitable for ANTHROPIC_BASE_URL / OPENAI_BASE_URL.
 */
export async function ensureProxy(upstream: ProxyUpstream): Promise<ProxyHandle> {
  const key = upstreamKey(upstream)
  const existing = instances.get(key)
  if (existing) {
    existing.lastUsed = Date.now()
    return { url: existing.server.url, port: existing.port }
  }

  const inflight = pendingEnsure.get(key)
  if (inflight) return inflight

  const create = (async (): Promise<ProxyHandle> => {
    // Re-check after await gap (another waiter may have finished).
    const raced = instances.get(key)
    if (raced) {
      raced.lastUsed = Date.now()
      return { url: raced.server.url, port: raced.port }
    }
    const port = await getFreePort()
    const server = await startLlmProxyServer(upstream, port)
    const inst: ProxyInstance = {
      port,
      server,
      lastUsed: Date.now(),
      upstream,
    }
    instances.set(key, inst)
    startSweepIfNeeded()
    return { url: server.url, port }
  })().finally(() => {
    pendingEnsure.delete(key)
  })

  pendingEnsure.set(key, create)
  return create
}

export async function shutdownAll(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  const closing = [...instances.values()].map((inst) => inst.server.close().catch(() => undefined))
  instances.clear()
  await Promise.all(closing)
}

/** Test helper: number of live proxy instances. */
export function proxyInstanceCount(): number {
  return instances.size
}
