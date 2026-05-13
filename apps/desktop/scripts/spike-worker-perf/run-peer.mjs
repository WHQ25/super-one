import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURE = resolve(__dirname, 'peer-fixture.mjs')

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
function fmt(arr) {
  return `p50=${pct(arr, 0.5).toFixed(3)}ms  p90=${pct(arr, 0.9).toFixed(3)}ms  p99=${pct(arr, 0.99).toFixed(3)}ms  min=${Math.min(...arr).toFixed(3)}  max=${Math.max(...arr).toFixed(3)}  n=${arr.length}`
}
const nsToMs = (n) => Number(n) / 1_000_000

async function spawnReady(role) {
  const w = new Worker(FIXTURE, { workerData: { role } })
  await new Promise((res, rej) => {
    const onMsg = (m) => { if (m.type === 'ready') { w.off('message', onMsg); res() } }
    w.on('message', onMsg)
    w.once('error', rej)
  })
  return w
}

async function rttLatency(emitter, listener, payloadKb, n) {
  const samples = []
  const payload = { blob: 'x'.repeat(payloadKb * 1024) }

  let pending = null
  emitter.on('message', (msg) => {
    if (msg.type === 'peer-emit' && pending && msg.seq === pending.seq) {
      pending.tMainRecv = process.hrtime.bigint()
      listener.postMessage({ type: 'peer-deliver', seq: msg.seq, payload: msg.payload })
    }
  })
  listener.on('message', (msg) => {
    if (msg.type === 'ack' && pending && msg.seq === pending.seq) {
      const tMainAck = process.hrtime.bigint()
      const rtt = nsToMs(tMainAck - pending.tStart)
      samples.push(rtt)
      pending.resolve()
    }
  })

  for (let seq = 0; seq < n; seq++) {
    await new Promise((resolve) => {
      pending = { seq, tStart: process.hrtime.bigint(), resolve }
      emitter.postMessage({ type: 'emit-one', event: 'progress', payload, seq })
    })
  }

  emitter.removeAllListeners('message')
  listener.removeAllListeners('message')
  return samples
}

async function throughput(emitter, listener, count) {
  let received = 0
  let tFirst = null
  let tLast = null
  const doneP = new Promise((resolve) => {
    emitter.on('message', (msg) => {
      if (msg.type === 'peer-emit') {
        if (received === 0) tFirst = process.hrtime.bigint()
        listener.postMessage({ type: 'peer-deliver', seq: msg.seq, payload: msg.payload })
      }
    })
    listener.on('message', (msg) => {
      if (msg.type === 'ack') {
        received++
        if (received === count) { tLast = process.hrtime.bigint(); resolve() }
      }
    })
  })
  const tStart = process.hrtime.bigint()
  emitter.postMessage({ type: 'emit-batch', count, payload: 'small' })
  await doneP
  const wallMs = nsToMs(tLast - tStart)
  emitter.removeAllListeners('message')
  listener.removeAllListeners('message')
  return { wallMs, eventsPerSec: count / (wallMs / 1000) }
}

async function main() {
  console.log(`Node: ${process.versions.node}  v8: ${process.versions.v8}  electron: ${process.versions.electron ?? 'n/a'}`)

  const emitter = await spawnReady('emitter')
  const listener = await spawnReady('listener')

  console.log('\n=== Single-event RTT (one-at-a-time) ===')
  for (const kb of [0, 1, 16, 256]) {
    await rttLatency(emitter, listener, kb, 50)
    const samples = await rttLatency(emitter, listener, kb, 500)
    console.log(`  payload=${kb === 0 ? '< 1KB' : kb + 'KB'}: ${fmt(samples)}`)
  }

  console.log('\n=== Burst throughput (emit N back-to-back, count acks) ===')
  for (const n of [100, 1000, 5000]) {
    const r = await throughput(emitter, listener, n)
    console.log(`  ${n} events: wall=${r.wallMs.toFixed(1)}ms  rate=${Math.round(r.eventsPerSec).toLocaleString()} ev/s`)
  }

  await emitter.terminate()
  await listener.terminate()
}

main().then(() => setTimeout(() => process.exit(0), 50)).catch((e) => { console.error(e); process.exit(1) })
