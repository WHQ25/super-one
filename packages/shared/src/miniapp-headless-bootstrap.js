/**
 * Worker entry point for mini-app headless tool execution.
 *
 * Spawned by miniapp-worker-host.ts as the Worker's main script.
 * Sets up globalThis.superone, dynamic-imports the mini-app author's service.mjs,
 * then waits for { type: 'call' } messages from main and dispatches to registered handlers.
 *
 * workerData expected:
 *   - appId: string
 *   - sessionId: string
 *   - headlessEntry: string (absolute path to author's service file)
 */
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { createSuperoneHeadless } from './miniapp-headless-runtime.js'

if (!parentPort) {
  throw new Error('miniapp-headless-bootstrap must run as a Worker (parentPort missing)')
}

const handlers = new Map()
const kvPending = new Map()
globalThis.superone = createSuperoneHeadless({
  appId: workerData.appId,
  sessionId: workerData.sessionId,
  parentPort,
  handlers,
  kvPending,
})

try {
  await import(pathToFileURL(workerData.headlessEntry).href)
} catch (err) {
  parentPort.postMessage({
    type: 'bootstrap-error',
    error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  })
  process.exit(1)
}

parentPort.postMessage({ type: 'ready' })

parentPort.on('message', async (msg) => {
  if (!msg) return
  if (msg.type === 'kv-result') {
    const pending = kvPending.get(msg.requestId)
    if (!pending) return
    kvPending.delete(msg.requestId)
    if (msg.error) pending.reject(new Error(msg.error))
    else pending.resolve(msg.result)
    return
  }
  if (msg.type !== 'call') return
  const handler = handlers.get(msg.toolName)
  if (!handler) {
    parentPort.postMessage({
      type: 'error',
      callId: msg.callId,
      error: `Tool '${msg.toolName}' is not registered in service.mjs (manifest declared it but service did not call superone.tools.handle).`,
    })
    return
  }
  try {
    const result = await handler(msg.args ?? {})
    parentPort.postMessage({ type: 'result', callId: msg.callId, result })
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      callId: msg.callId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
