import { parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

void fileURLToPath
void dirname
void workerData

const initDoneAt = performance.now()

parentPort.postMessage({ type: 'ready', initDoneAt })

parentPort.on('message', (msg) => {
  if (msg.type === 'call') {
    const h = createHash('sha256').update(String(msg.args?.n ?? 0)).digest('hex')
    parentPort.postMessage({ type: 'result', callId: msg.callId, result: { hash: h, echo: msg.args } })
  }
})
