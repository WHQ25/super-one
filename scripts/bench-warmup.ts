import { query, startup, type Options } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'module'

const moduleRequire = createRequire(import.meta.url)

function resolveCli(): string {
  const sdkDir = moduleRequire.resolve('@anthropic-ai/claude-agent-sdk').replace(/[/\\][^/\\]+$/, '')
  return `${sdkDir}/cli.js`
}

const ROUNDS = Number(process.argv[2] ?? 5)
const cliPath = resolveCli()
const cwd = process.cwd()

const baseOptions: Options = {
  pathToClaudeCodeExecutable: cliPath,
  cwd,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  settingSources: [],
}

interface Sample {
  spawnToInitMs: number
  spawnToFirstAssistantMs?: number
  totalMs: number
}

async function runCold(): Promise<Sample> {
  const t0 = performance.now()
  let initAt = 0
  let firstAssistantAt = 0
  const q = query({
    prompt: 'reply with the single word: ok',
    options: baseOptions,
  })
  for await (const msg of q) {
    if (!initAt && msg.type === 'system' && (msg as any).subtype === 'init') {
      initAt = performance.now()
    }
    if (!firstAssistantAt && msg.type === 'assistant') {
      firstAssistantAt = performance.now()
    }
    if (msg.type === 'result') break
  }
  const t1 = performance.now()
  return {
    spawnToInitMs: initAt - t0,
    spawnToFirstAssistantMs: firstAssistantAt ? firstAssistantAt - t0 : undefined,
    totalMs: t1 - t0,
  }
}

async function runWarm(): Promise<{ warmupMs: number; sample: Sample }> {
  const tWarm0 = performance.now()
  const warm = await startup({ options: baseOptions })
  const tWarm1 = performance.now()
  const warmupMs = tWarm1 - tWarm0

  const t0 = performance.now()
  let initAt = 0
  let firstAssistantAt = 0
  const q = warm.query('reply with the single word: ok')
  for await (const msg of q) {
    if (!initAt && msg.type === 'system' && (msg as any).subtype === 'init') {
      initAt = performance.now()
    }
    if (!firstAssistantAt && msg.type === 'assistant') {
      firstAssistantAt = performance.now()
    }
    if (msg.type === 'result') break
  }
  const t1 = performance.now()
  return {
    warmupMs,
    sample: {
      spawnToInitMs: initAt - t0,
      spawnToFirstAssistantMs: firstAssistantAt ? firstAssistantAt - t0 : undefined,
      totalMs: t1 - t0,
    },
  }
}

function fmt(n?: number): string {
  if (n === undefined) return '   n/a '
  return `${n.toFixed(0).padStart(5)} ms`
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

async function main(): Promise<void> {
  console.log(`# warmup benchmark — ${ROUNDS} rounds each`)
  console.log(`# cli=${cliPath}`)
  console.log(`# cwd=${cwd}\n`)

  const coldSamples: Sample[] = []
  const warmSamples: Sample[] = []
  const warmupTimes: number[] = []

  console.log('## COLD (query() directly)')
  console.log('round | spawn→init | spawn→assistant | total')
  for (let i = 0; i < ROUNDS; i++) {
    const s = await runCold()
    coldSamples.push(s)
    console.log(`  ${i + 1}    | ${fmt(s.spawnToInitMs)} | ${fmt(s.spawnToFirstAssistantMs)}    | ${fmt(s.totalMs)}`)
  }

  console.log('\n## WARM (startup() then warm.query())')
  console.log('round | warmup     | query→init | query→assistant | query total')
  for (let i = 0; i < ROUNDS; i++) {
    const r = await runWarm()
    warmSamples.push(r.sample)
    warmupTimes.push(r.warmupMs)
    console.log(`  ${i + 1}    | ${fmt(r.warmupMs)}  | ${fmt(r.sample.spawnToInitMs)} | ${fmt(r.sample.spawnToFirstAssistantMs)}    | ${fmt(r.sample.totalMs)}`)
  }

  console.log('\n## SUMMARY (avg)')
  const coldInit = avg(coldSamples.map(s => s.spawnToInitMs))
  const warmInit = avg(warmSamples.map(s => s.spawnToInitMs))
  const coldAsst = avg(coldSamples.filter(s => s.spawnToFirstAssistantMs).map(s => s.spawnToFirstAssistantMs!))
  const warmAsst = avg(warmSamples.filter(s => s.spawnToFirstAssistantMs).map(s => s.spawnToFirstAssistantMs!))
  const warmupAvg = avg(warmupTimes)

  console.log(`cold  spawn→init       : ${fmt(coldInit)}`)
  console.log(`warm  query→init       : ${fmt(warmInit)}    (saves ${fmt(coldInit - warmInit)}, ${((1 - warmInit / coldInit) * 100).toFixed(0)}%)`)
  console.log(`cold  spawn→assistant  : ${fmt(coldAsst)}`)
  console.log(`warm  query→assistant  : ${fmt(warmAsst)}    (saves ${fmt(coldAsst - warmAsst)}, ${((1 - warmAsst / coldAsst) * 100).toFixed(0)}%)`)
  console.log(`warmup() upfront cost  : ${fmt(warmupAvg)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
