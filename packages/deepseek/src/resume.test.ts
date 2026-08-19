/**
 * Cold resume: a new process (here, a new tree) picks a session back up from
 * dsh's own JSONL log. Two things have to hold at once — the model must see the
 * earlier conversation, and SuperOne's transcript must NOT see it again. dsh
 * seeds a resumed session through its constructor and constructor seeds never
 * publish on the `session/event` firehose, which is exactly what keeps the
 * second property true; this test is what would catch that changing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'

/** Records every transcript it is asked to complete, then answers plainly. */
class RecordingAdapter extends LlmAdapter {
  readonly transcripts: string[] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.transcripts.push(JSON.stringify(options.messages))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
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
  const runtime = await DeepseekRuntime.create({ persona: 'test agent', persistenceRoot })
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

afterEach(async () => {
  while (runtimes.length) await runtimes.pop()?.dispose().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('deepseek cold resume', () => {
  it('restores the conversation for the model without replaying it into the transcript', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-resume-'))
    dirs.push(persistenceRoot)
    const sessionId = randomUUID()

    const first = await bootRuntime(persistenceRoot)
    const firstAgent = await first.runtime.createAgent({
      sessionId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      onEvent: () => {},
    })
    await runTurn(firstAgent, 'the codeword is banana')
    await firstAgent.dispose()
    await first.runtime.dispose()
    runtimes.pop()

    // A second tree with no memory of the first: everything it knows has to
    // come off the JSONL log under the same session id.
    const second = await bootRuntime(persistenceRoot)
    const events: AgentEvent[] = []
    const resumed = await second.runtime.createAgent({
      sessionId,
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      resume: true,
      onEvent: (event) => events.push(event),
    })
    await runTurn(resumed, 'what was the codeword?')

    // The model sees the earlier turn...
    expect(second.adapter.transcripts.at(-1)).toContain('the codeword is banana')
    // ...while SuperOne's transcript only receives the new one. A replayed seed
    // here would duplicate the whole conversation in the chat view.
    const userTurns = events.filter(
      (event) => event.type === 'content_delta' && event.delta.type === 'text',
    )
    expect(userTurns.length).toBeGreaterThan(0)
    expect(JSON.stringify(events)).not.toContain('the codeword is banana')
  })

  it('starts a fresh session when there is nothing to resume', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-resume-'))
    dirs.push(persistenceRoot)
    const { runtime, adapter } = await bootRuntime(persistenceRoot)

    const agent = await runtime.createAgent({
      sessionId: randomUUID(),
      cwd: process.cwd(),
      provider: 'mock',
      model: 'mock-1',
      onEvent: () => {},
    })
    await runTurn(agent, 'hello')

    expect(adapter.transcripts).toHaveLength(1)
  })
})
