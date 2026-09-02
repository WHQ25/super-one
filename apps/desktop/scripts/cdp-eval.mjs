/**
 * Evaluate an expression inside the running dev renderer over CDP.
 *
 * `electron-vite dev` exposes the port when REMOTE_DEBUGGING_PORT is set, which
 * makes driving the renderer directly far cheaper than synthesizing clicks.
 *
 *   REMOTE_DEBUGGING_PORT=9222 bun run dev
 *   bun apps/desktop/scripts/cdp-eval.mjs 'useChatStore.getState().activeProject'
 *   bun apps/desktop/scripts/cdp-eval.mjs --file probe.js
 */
import { readFileSync } from 'node:fs'
import { WebSocket } from 'ws'

const PORT = process.env.REMOTE_DEBUGGING_PORT || '9222'
const args = process.argv.slice(2)
const expression = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args[0]
if (!expression) {
  console.error('usage: cdp-eval.mjs <expression> | --file <path>')
  process.exit(2)
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && (t.url.startsWith('http') || t.url.startsWith('file:')))
if (!page) {
  console.error('no renderer page target; is the dev app running with REMOTE_DEBUGGING_PORT?')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.once('open', resolve)
  ws.once('error', reject)
})

const result = await new Promise((resolve, reject) => {
  const timeoutMs = Number(process.env.CDP_TIMEOUT_MS || 30_000)
  const timer = setTimeout(() => reject(new Error('CDP evaluate timed out')), timeoutMs)
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id !== 1) return
    clearTimeout(timer)
    resolve(msg.result)
  })
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression,
      awaitPromise: true,
      returnByValue: true,
      // Store actions are reached through the module graph, not a global.
      includeCommandLineAPI: true,
    },
  }))
})
ws.close()

if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails.exception ?? result.exceptionDetails, null, 2))
  process.exit(1)
}
const value = result.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
