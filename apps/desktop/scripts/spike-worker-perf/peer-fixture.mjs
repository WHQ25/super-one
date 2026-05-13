import { parentPort, workerData } from 'node:worker_threads'

const role = workerData?.role

parentPort.postMessage({ type: 'ready', role })

if (role === 'emitter') {
  parentPort.on('message', (msg) => {
    if (msg.type === 'emit-one') {
      parentPort.postMessage({ type: 'peer-emit', event: msg.event, payload: msg.payload, seq: msg.seq })
    } else if (msg.type === 'emit-batch') {
      for (let i = 0; i < msg.count; i++) {
        parentPort.postMessage({ type: 'peer-emit', event: 'progress', payload: { i, data: msg.payload }, seq: i })
      }
      parentPort.postMessage({ type: 'batch-done', count: msg.count })
    }
  })
} else if (role === 'listener') {
  parentPort.on('message', (msg) => {
    if (msg.type === 'peer-deliver') {
      parentPort.postMessage({ type: 'ack', seq: msg.seq })
    }
  })
}
