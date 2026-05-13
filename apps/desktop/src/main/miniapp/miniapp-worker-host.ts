import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { emitPeer } from './miniapp-peer-bus'
import { trace } from '../agent/event-trace'
import type { KvOp, KvRequestArgs } from './miniapp-kv'

type KvHandler = (appId: string, op: KvOp, args: KvRequestArgs) => unknown
let cachedKvHandler: KvHandler | null = null
async function getKvHandler(): Promise<KvHandler> {
  if (cachedKvHandler) return cachedKvHandler
  const mod = await import('./miniapp-kv')
  cachedKvHandler = mod.handleKvRequest
  return cachedKvHandler
}

const moduleRequire = createRequire(import.meta.url)
let cachedBootstrapPath: string | null = null

function resolveBootstrapPath(): string {
  if (cachedBootstrapPath) return cachedBootstrapPath
  cachedBootstrapPath = moduleRequire.resolve('@superone/shared/miniapp-headless-bootstrap')
  return cachedBootstrapPath
}

export interface HeadlessCallOptions {
  sessionId: string
  appId: string
  headlessEntry: string
  toolName: string
  args: Record<string, unknown>
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

export async function executeHeadlessTool(opts: HeadlessCallOptions): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bootstrap = resolveBootstrapPath()
  const worker = new Worker(bootstrap, {
    workerData: {
      sessionId: opts.sessionId,
      appId: opts.appId,
      headlessEntry: opts.headlessEntry,
    },
  })
  const callId = randomUUID()

  const onSideChannel = (m: WorkerMessage) => {
    if (m.type === 'peer-emit') {
      trace('miniapp.peer', 'worker-emit', { sessionId: opts.sessionId, appId: opts.appId, event: m.event, payload: m.payload })
      emitPeer(opts.sessionId, opts.appId, m.event, m.payload)
    } else if (m.type === 'kv-op') {
      const requestId = m.requestId
      getKvHandler()
        .then((handler) => handler(opts.appId, m.op, m.args))
        .then((result) => worker.postMessage({ type: 'kv-result', requestId, result }))
        .catch((err: unknown) =>
          worker.postMessage({
            type: 'kv-result',
            requestId,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
    }
  }
  worker.on('message', onSideChannel)

  try {
    await waitForReady(worker, timeoutMs)
    return await runCall(worker, callId, opts.toolName, opts.args, timeoutMs)
  } finally {
    worker.off('message', onSideChannel)
    await worker.terminate().catch(() => undefined)
  }
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'bootstrap-error'; error: string }
  | { type: 'result'; callId: string; result: unknown }
  | { type: 'error'; callId: string; error: string }
  | { type: 'peer-emit'; event: string; payload: unknown }
  | { type: 'kv-op'; requestId: string; op: KvOp; args: KvRequestArgs }

function waitForReady(worker: Worker, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMsg)
      worker.off('error', onError)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Worker ready timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMsg = (m: WorkerMessage) => {
      if (m.type === 'ready') {
        cleanup()
        resolve()
      } else if (m.type === 'bootstrap-error') {
        cleanup()
        reject(new Error(m.error))
      }
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    worker.on('message', onMsg)
    worker.once('error', onError)
  })
}

function runCall(
  worker: Worker,
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMsg)
      worker.off('error', onError)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMsg = (m: WorkerMessage) => {
      if (m.type !== 'result' && m.type !== 'error') return
      if (m.callId !== callId) return
      cleanup()
      if (m.type === 'result') resolve(m.result)
      else reject(new Error(m.error))
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    worker.on('message', onMsg)
    worker.once('error', onError)
    worker.postMessage({ type: 'call', callId, toolName, args })
  })
}
