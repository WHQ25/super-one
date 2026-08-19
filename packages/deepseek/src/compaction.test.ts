import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'

const SUMMARY_TEXT = 'the conversation so far, in brief'

/**
 * Answers every turn with one short line, and the summarization call with a
 * recognisable one. `purpose: 'compaction'` is how compaction-basic marks its
 * direct `llm.stream()` call, which is also the only thing separating it from
 * an ordinary turn at this seam.
 */
class SummarizingAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const compacting = (options as { purpose?: string }).purpose === 'compaction'
    const text = compacting ? SUMMARY_TEXT : 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Mock' }
  }

  override async listModels(provider: string) {
    return [{ provider, id: 'mock-1', name: 'Mock One' }]
  }

  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 200_000 } }
  }
}

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function session(turns: number) {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-compaction-'))
  dirs.push(cwd)

  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new SummarizingAdapter())

  const events: AgentEvent[] = []
  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
  })
  disposers.push(() => agent.dispose())

  for (let turn = 0; turn < turns; turn += 1) {
    agent.sendText(`turn ${turn}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await agent.whenIdle()
  }
  return { runtime, sessionId, agent, events }
}

describe('deepseek compaction', () => {
  it('brackets a manual compaction with the compacting indicator and a boundary', async () => {
    const { runtime, sessionId, events } = await session(3)
    events.length = 0

    await runtime.compactSession(sessionId)

    const indicators = events.filter((event) => event.type === 'status_indicator')
    expect(indicators[0]).toMatchObject({ indicator: 'compacting' })
    expect(indicators.at(-1)).toMatchObject({ indicator: null, compactResult: 'success' })

    const boundary = events.find((event) => event.type === 'compact_boundary')
    // `/compact` is a standalone transaction between turns, which dsh records
    // as `turn: null` — that is what distinguishes it from pressure.
    expect(boundary).toMatchObject({ trigger: 'manual' })
    expect(boundary?.type === 'compact_boundary' && boundary.preTokens).toBeGreaterThan(0)
  })

  /**
   * The replacement is a `user/message` carrying the summary with
   * `surfaceOp: replace`. It shadows history the chat panel already shows, so
   * mapping it would duplicate the transcript rather than compact it.
   */
  it('publishes no transcript message for the summary replacement', async () => {
    const { runtime, sessionId, events } = await session(3)
    events.length = 0

    await runtime.compactSession(sessionId)

    expect(events.some((event) => event.type === 'message_start')).toBe(false)
    const text = JSON.stringify(events)
    expect(text).not.toContain(SUMMARY_TEXT)
  })

  it('reports a failure instead of a boundary when compaction is already running', async () => {
    const { runtime, sessionId, events } = await session(3)
    events.length = 0

    // Two manual compactions racing: dsh's durable lock rejects the loser with
    // `busy`, and it must not leave the indicator spinning.
    const results = await Promise.allSettled([
      runtime.compactSession(sessionId),
      runtime.compactSession(sessionId),
    ])

    expect(results.some((result) => result.status === 'rejected')).toBe(true)
    const last = events.filter((event) => event.type === 'status_indicator').at(-1)
    expect(last).toMatchObject({ indicator: null })
  })
})
