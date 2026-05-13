import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SERVICE_PATH = resolve(__dirname, 'service-fixture.mjs')

const ITER = Number(process.env.SPIKE_ITER ?? 100)
const WARMUP = 5
const CONCURRENCY_LEVELS = [3, 5, 10]

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

function fmt(arr) {
  const mn = Math.min(...arr).toFixed(1)
  const mx = Math.max(...arr).toFixed(1)
  return `p50=${pct(arr, 0.5).toFixed(1)}ms  p90=${pct(arr, 0.9).toFixed(1)}ms  p99=${pct(arr, 0.99).toFixed(1)}ms  min=${mn}  max=${mx}  n=${arr.length}`
}

async function oneCall() {
  const t0 = performance.now()
  const worker = new Worker(SERVICE_PATH)

  const tReady = await new Promise((res, rej) => {
    worker.once('message', (m) => {
      if (m.type === 'ready') res(performance.now())
      else rej(new Error('expected ready, got: ' + JSON.stringify(m)))
    })
    worker.once('error', rej)
  })

  const tCallSent = performance.now()
  const callP = new Promise((res, rej) => {
    worker.once('message', (m) => {
      if (m.type === 'result') res(performance.now())
      else rej(new Error('expected result, got: ' + JSON.stringify(m)))
    })
    worker.once('error', rej)
  })
  worker.postMessage({ type: 'call', callId: 'c1', args: { n: 42 } })
  const tCallDone = await callP

  const tTerminateStart = performance.now()
  await worker.terminate()
  const tEnd = performance.now()

  return {
    spawnToReady: tReady - t0,
    callRTT: tCallDone - tCallSent,
    terminate: tEnd - tTerminateStart,
    total: tEnd - t0,
  }
}

async function runSequential() {
  console.log(`\n=== Sequential: ${ITER} iterations (after ${WARMUP} warmup) ===`)
  for (let i = 0; i < WARMUP; i++) await oneCall()

  const samples = { spawnToReady: [], callRTT: [], terminate: [], total: [] }
  const rssBefore = process.memoryUsage().rss
  for (let i = 0; i < ITER; i++) {
    const r = await oneCall()
    samples.spawnToReady.push(r.spawnToReady)
    samples.callRTT.push(r.callRTT)
    samples.terminate.push(r.terminate)
    samples.total.push(r.total)
  }
  const rssAfter = process.memoryUsage().rss

  console.log(`  spawn→ready:  ${fmt(samples.spawnToReady)}`)
  console.log(`  call RTT:     ${fmt(samples.callRTT)}`)
  console.log(`  terminate:    ${fmt(samples.terminate)}`)
  console.log(`  TOTAL:        ${fmt(samples.total)}`)
  console.log(`  RSS delta:    ${((rssAfter - rssBefore) / 1024 / 1024).toFixed(1)} MB`)
}

async function runConcurrent(n) {
  const rssBefore = process.memoryUsage().rss
  const t0 = performance.now()
  await Promise.all(Array.from({ length: n }, () => oneCall()))
  const elapsed = performance.now() - t0
  const rssAfter = process.memoryUsage().rss
  console.log(`  concurrency=${n}:  wall=${elapsed.toFixed(1)}ms  rss peak Δ=${((rssAfter - rssBefore) / 1024 / 1024).toFixed(1)} MB`)
}

async function main() {
  console.log(`Node: ${process.versions.node}  v8: ${process.versions.v8}  platform: ${process.platform} ${process.arch}`)
  console.log(`Service path: ${SERVICE_PATH}`)

  await runSequential()

  console.log(`\n=== Concurrent spawn ===`)
  for (const n of CONCURRENCY_LEVELS) {
    for (let i = 0; i < 3; i++) await runConcurrent(n)
  }

  if (process.versions.electron) {
    console.log(`\n[Electron build: ${process.versions.electron}]`)
  }
}

main().then(() => {
  setTimeout(() => process.exit(0), 100)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})
