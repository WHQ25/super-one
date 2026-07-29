/**
 * Main-to-renderer streaming transport benchmark.
 *
 * Compares the previous one-full-event-per-IPC path with the current batched
 * RendererAgentEventTransport. V8 serialization size approximates structured
 * clone payload volume; structuredClone timing approximates cross-context copy
 * cost. This intentionally does not claim to measure React, Markdown, GPU, or
 * whole-app power usage.
 *
 *   bun run bench:agent-events
 *   bun run bench:agent-events -- --samples 25
 *   bun apps/desktop/scripts/bench-agent-event-transport.ts --json
 */
import { performance } from 'node:perf_hooks'
import { serialize } from 'node:v8'
import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { createRendererAgentEventTransport } from '../src/main/agent/renderer-agent-event-transport'

const DEFAULT_SAMPLES = 15
const WARMUP_SAMPLES = 3
const BATCH_SIZE = 4
const TIMING_LOOPS = 10
const LONG_BATCH_MS = 60_000

interface Scenario {
  name: string
  events: AgentEvent[]
  expectedText: string
}

interface TimingSummary {
  medianMs: number
  minMs: number
  maxMs: number
}

interface BenchResult {
  scenario: string
  sourceEvents: number
  oldIpcCalls: number
  newIpcCalls: number
  oldWireBytes: number
  newWireBytes: number
  wireReductionPercent: number
  oldClone: TimingSummary
  newClone: TimingSummary
  cloneSpeedup: number
}

function parseSampleCount(args: string[]): number {
  const index = args.indexOf('--samples')
  if (index === -1) return DEFAULT_SAMPLES
  const value = Number(args[index + 1])
  if (!Number.isInteger(value) || value < 3) {
    throw new Error('--samples must be an integer >= 3')
  }
  return value
}

function commandScenario(): Scenario {
  const updates = 128
  const finalBytes = 336 * 1024
  const chunk = 'x'.repeat(finalBytes / updates)
  const events: AgentEvent[] = []
  for (let i = 1; i <= updates; i++) {
    events.push({
      type: 'codex_item_delta',
      projectPath: '/bench',
      sessionId: 'session-command',
      messageId: 'message-command',
      seq: i,
      phase: i === 1 ? 'started' : 'updated',
      item: {
        id: 'command-1',
        type: 'command_execution',
        command: 'bun run build',
        aggregatedOutput: chunk.repeat(i),
        status: 'in_progress',
      },
    })
  }
  return {
    name: 'Codex command (336 KiB)',
    events,
    expectedText: chunk.repeat(updates),
  }
}

function reasoningScenario(): Scenario {
  const updates = 192
  const finalBytes = 96 * 1024
  const chunk = 'r'.repeat(finalBytes / updates)
  const events: AgentEvent[] = []
  for (let i = 1; i <= updates; i++) {
    events.push({
      type: 'codex_item_delta',
      projectPath: '/bench',
      sessionId: 'session-reasoning',
      messageId: 'message-reasoning',
      seq: i,
      phase: i === 1 ? 'started' : 'updated',
      item: {
        id: 'reasoning-1',
        type: 'reasoning',
        text: chunk.repeat(i),
        startedAt: 1,
      },
    })
  }
  return {
    name: 'Codex reasoning (96 KiB)',
    events,
    expectedText: chunk.repeat(updates),
  }
}

function sequencedTextScenario(): Scenario {
  const updates = 600
  const chunk = 'stream-delta-0123456789\n'
  const events: AgentEvent[] = Array.from({ length: updates }, (_, index) => ({
    type: 'content_delta',
    projectPath: '/bench',
    sessionId: 'session-content',
    messageId: 'message-content',
    epoch: 1,
    seq: index + 1,
    delta: { type: 'text', text: chunk },
  }))
  return {
    name: 'Shared sequenced text',
    events,
    expectedText: chunk.repeat(updates),
  }
}

function runOptimized(events: AgentEvent[], onSend: (batch: AgentEvent[]) => void): void {
  const transport = createRendererAgentEventTransport(onSend, LONG_BATCH_MS)
  for (let i = 0; i < events.length; i++) {
    transport.push(events[i])
    if ((i + 1) % BATCH_SIZE === 0) transport.flush()
  }
  transport.flush()
  transport.dispose()
}

function optimizedPayloads(events: AgentEvent[]): AgentEvent[][] {
  const payloads: AgentEvent[][] = []
  runOptimized(events, (batch) => payloads.push(batch))
  return payloads
}

function appendCodexPatch(item: CodexThreadItem, event: Extract<AgentEvent, { type: 'codex_item_patch' }>): CodexThreadItem {
  const patch = event.patch
  if (item.type !== patch.type) throw new Error(`Patch type mismatch: ${item.type} vs ${patch.type}`)
  if (item.type === 'command_execution' && patch.type === 'command_execution') {
    return { ...item, aggregatedOutput: item.aggregatedOutput + patch.aggregatedOutputDelta }
  }
  if (item.type === 'reasoning' && patch.type === 'reasoning') {
    return {
      ...item,
      text: item.text + patch.textDelta,
      startedAt: patch.startedAt,
      endedAt: patch.endedAt,
    }
  }
  if (item.type === 'agent_message' && patch.type === 'agent_message') {
    return { ...item, text: item.text + patch.textDelta }
  }
  if (item.type === 'plan' && patch.type === 'plan') {
    return { ...item, text: item.text + patch.textDelta }
  }
  if (item.type === 'review' && patch.type === 'review') {
    return { ...item, text: item.text + patch.textDelta }
  }
  throw new Error(`Unsupported patch type: ${patch.type}`)
}

function assertEquivalent(scenario: Scenario, payloads: AgentEvent[][]): void {
  let codexItem: CodexThreadItem | null = null
  let contentText = ''
  for (const event of payloads.flat()) {
    if (event.type === 'codex_item_delta') codexItem = event.item
    else if (event.type === 'codex_item_patch') {
      if (!codexItem) throw new Error(`${scenario.name}: patch arrived before a full item`)
      codexItem = appendCodexPatch(codexItem, event)
    } else if (event.type === 'content_delta' && event.delta.type === 'text') {
      contentText += event.delta.text
    }
  }

  const actual = codexItem?.type === 'command_execution'
    ? codexItem.aggregatedOutput
    : codexItem?.type === 'reasoning'
      ? codexItem.text
      : contentText
  if (actual !== scenario.expectedText) {
    throw new Error(`${scenario.name}: optimized payload did not reconstruct the source stream`)
  }
}

function wireBytes(payloads: unknown[]): number {
  let total = 0
  for (const payload of payloads) total += serialize(payload).byteLength
  return total
}

function summarize(times: number[]): TimingSummary {
  const sorted = [...times].sort((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    minMs: sorted[0],
    maxMs: sorted.at(-1) ?? sorted[0],
  }
}

function timeClonePaths(events: AgentEvent[], samples: number): { oldClone: TimingSummary; newClone: TimingSummary } {
  const oldTimes: number[] = []
  const newTimes: number[] = []

  const cloneOld = (): void => {
    for (let loop = 0; loop < TIMING_LOOPS; loop++) {
      for (const event of events) structuredClone(event)
    }
  }
  const cloneNew = (): void => {
    for (let loop = 0; loop < TIMING_LOOPS; loop++) {
      runOptimized(events, (batch) => { structuredClone(batch) })
    }
  }

  for (let i = 0; i < WARMUP_SAMPLES; i++) {
    cloneOld()
    cloneNew()
  }
  for (let i = 0; i < samples; i++) {
    const first = i % 2 === 0 ? cloneOld : cloneNew
    const second = i % 2 === 0 ? cloneNew : cloneOld
    const firstTimes = i % 2 === 0 ? oldTimes : newTimes
    const secondTimes = i % 2 === 0 ? newTimes : oldTimes

    let startedAt = performance.now()
    first()
    firstTimes.push((performance.now() - startedAt) / TIMING_LOOPS)
    startedAt = performance.now()
    second()
    secondTimes.push((performance.now() - startedAt) / TIMING_LOOPS)
  }
  return { oldClone: summarize(oldTimes), newClone: summarize(newTimes) }
}

function runScenario(scenario: Scenario, samples: number): BenchResult {
  const optimized = optimizedPayloads(scenario.events)
  assertEquivalent(scenario, optimized)
  const oldWireBytes = wireBytes(scenario.events)
  const newWireBytes = wireBytes(optimized)
  const timing = timeClonePaths(scenario.events, samples)
  return {
    scenario: scenario.name,
    sourceEvents: scenario.events.length,
    oldIpcCalls: scenario.events.length,
    newIpcCalls: optimized.length,
    oldWireBytes,
    newWireBytes,
    wireReductionPercent: (1 - newWireBytes / oldWireBytes) * 100,
    oldClone: timing.oldClone,
    newClone: timing.newClone,
    cloneSpeedup: timing.oldClone.medianMs / timing.newClone.medianMs,
  }
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}

function formatMs(ms: number): string {
  return ms.toFixed(2)
}

function printTable(results: BenchResult[], samples: number): void {
  console.log('# Agent event transport benchmark')
  console.log('')
  console.log(`samples=${samples}, warmup=${WARMUP_SAMPLES}, timing-loops=${TIMING_LOOPS}, events/window=${BATCH_SIZE}`)
  console.log('scope=main-to-renderer event batching, patch encoding, and structured-clone proxy')
  console.log('')
  console.log('| Scenario | IPC old -> new | Wire MiB old -> new | Saved | Clone ms old -> new | Speedup |')
  console.log('|---|---:|---:|---:|---:|---:|')
  for (const result of results) {
    console.log(
      `| ${result.scenario} | ${result.oldIpcCalls} -> ${result.newIpcCalls}`
      + ` | ${formatMiB(result.oldWireBytes)} -> ${formatMiB(result.newWireBytes)}`
      + ` | ${result.wireReductionPercent.toFixed(1)}%`
      + ` | ${formatMs(result.oldClone.medianMs)} -> ${formatMs(result.newClone.medianMs)}`
      + ` | ${result.cloneSpeedup.toFixed(2)}x |`,
    )
  }
  console.log('')
  console.log('Clone timings are medians. Absolute times vary by machine; ratios and payload sizes are the comparison signal.')
  console.log('This benchmark does not measure React/Markdown rendering, GPU compositing, or total application power.')
}

const args = process.argv.slice(2)
const samples = parseSampleCount(args)
const scenarios = [commandScenario(), reasoningScenario(), sequencedTextScenario()]
const results = scenarios.map((scenario) => runScenario(scenario, samples))

if (args.includes('--json')) console.log(JSON.stringify({ samples, warmupSamples: WARMUP_SAMPLES, timingLoops: TIMING_LOOPS, batchSize: BATCH_SIZE, results }, null, 2))
else printTable(results, samples)
