/**
 * Fork is the one place dsh's session API is stricter than it looks:
 * `sessions.fork` rejects a source that is not live, and the usual fork is
 * cold — the user forks a session nobody is running. These tests drive the real
 * store and the real JSONL log, so a change in either shows up here.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'

class RecordingAdapter extends LlmAdapter {
  readonly transcripts: string[] = []
  private reply = 0

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.transcripts.push(JSON.stringify(options.messages))
    const text = `reply-${++this.reply}`
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
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 1000 } }
  }
}

const dirs: string[] = []
const runtimes: DeepseekRuntime[] = []

async function bootRuntime(persistenceRoot: string) {
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent', persistenceRoot })
  runtimes.push(runtime)
  const adapter = new RecordingAdapter()
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], adapter)
  return { runtime, adapter }
}

async function runTurn(agent: { sendText(text: string): void; whenIdle(): Promise<void> }, text: string) {
  agent.sendText(text)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await agent.whenIdle()
}

/** Fork anchors are what the desktop reads off `ChatMessage.metadata`. */
function forkAnchors(events: AgentEvent[]): string[] {
  return events
    .filter((event) => event.type === 'message_complete')
    .map((event) => (event.type === 'message_complete' ? event.metadata?.forkAnchorId : undefined))
    .filter((anchor): anchor is string => typeof anchor === 'string')
}

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.dispose().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('deepseek fork', () => {
  it('stamps every completed message with the seq a fork can cut at', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-fork-'))
    dirs.push(persistenceRoot)
    const { runtime } = await bootRuntime(persistenceRoot)
    const events: AgentEvent[] = []
    const agent = await runtime.createAgent({
      sessionId: randomUUID(),
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      onEvent: (event) => events.push(event),
    })

    await runTurn(agent, 'first')
    await runTurn(agent, 'second')

    const anchors = forkAnchors(events)
    expect(anchors).toHaveLength(2)
    // Monotonic seqs: the second turn cuts later in the same log.
    expect(Number(anchors[1])).toBeGreaterThan(Number(anchors[0]))
  })

  it('forks a cold session at a boundary and resumes the child from there', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-fork-'))
    dirs.push(persistenceRoot)
    const sourceId = randomUUID()

    const first = await bootRuntime(persistenceRoot)
    const events: AgentEvent[] = []
    const source = await first.runtime.createAgent({
      sessionId: sourceId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      onEvent: (event) => events.push(event),
    })
    await runTurn(source, 'keep this one')
    await runTurn(source, 'but not this one')
    const boundary = Number(forkAnchors(events)[0])
    await source.dispose()
    await first.runtime.dispose()
    runtimes.pop()

    // Cold: a brand-new tree, nothing live, exactly how the desktop forks a
    // session the user is not currently running.
    const second = await bootRuntime(persistenceRoot)
    const childId = randomUUID()
    await expect(second.runtime.forkSession(sourceId, childId, boundary)).resolves.toBe(childId)

    const child = await second.runtime.createAgent({
      sessionId: childId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      resume: true,
      onEvent: () => {},
    })
    await runTurn(child, 'continue')

    // Joined across every request, not just the last: the standard preset
    // composes auto-compaction, and its summarize call is an `llm.stream()`
    // too — so the most recent transcript is not necessarily the model turn.
    const transcript = second.adapter.transcripts.join('\n')
    expect(transcript).toContain('keep this one')
    // The boundary is inclusive of the first turn only: everything the user
    // forked away from must be absent from the child's history.
    expect(transcript).not.toContain('but not this one')
  })

  it('forks the whole log when no boundary is given', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-fork-'))
    dirs.push(persistenceRoot)
    const sourceId = randomUUID()
    const { runtime, adapter } = await bootRuntime(persistenceRoot)
    const source = await runtime.createAgent({
      sessionId: sourceId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      onEvent: () => {},
    })
    await runTurn(source, 'alpha')
    await runTurn(source, 'omega')

    // Source still live here — the other half of `sessions.fork`'s contract.
    const childId = randomUUID()
    await runtime.forkSession(sourceId, childId)

    const child = await runtime.createAgent({
      sessionId: childId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      resume: true,
      onEvent: () => {},
    })
    await runTurn(child, 'continue')

    // Joined across every request, not just the last: the standard preset
    // composes auto-compaction, and its summarize call is an `llm.stream()`
    // too — so the most recent transcript is not necessarily the model turn.
    const transcript = adapter.transcripts.join('\n')
    expect(transcript).toContain('alpha')
    expect(transcript).toContain('omega')
  })
})
