import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DeepseekRuntime } from '../runtime'

/**
 * Streams a short reply with a deliberate gap before the first token, so TTFT
 * projected from the real log is distinguishable from the total duration.
 */
class SlowFirstTokenAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await new Promise((resolve) => setTimeout(resolve, 30))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'the answer' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'the answer' } }
    yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 4 } }
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

/** Run one real turn and hand back the runtime plus its session id. */
async function oneTurn() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-trajectory-'))
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-trajectory-store-'))
  dirs.push(cwd, persistenceRoot)

  const runtime = await DeepseekRuntime.create({ persona: 'test agent', persistenceRoot })
  disposers.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new SlowFirstTokenAdapter())

  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: () => undefined,
  })
  disposers.push(() => agent.dispose())

  agent.sendText('what is the answer')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await agent.whenIdle()
  return { runtime, sessionId }
}

describe('trajectory over a real dsh session log', () => {
  it('projects the header, the prompt, and the reply of one turn', async () => {
    const { runtime, sessionId } = await oneTurn()
    const trajectory = await runtime.trajectory(sessionId)
    expect(trajectory).not.toBeNull()
    if (trajectory === null) return

    expect(trajectory.live).toBe(true)
    // The header must precede the first request: its prompt and tool catalog
    // are what that request was built from, and a record ordered after it
    // would attribute the wrong catalog to every call in the turn.
    const kinds = trajectory.records.map((record) => record.kind)
    expect(kinds).toContain('system')
    expect(kinds.indexOf('system')).toBeLessThan(kinds.indexOf('message'))

    const header = trajectory.headers[0]
    expect(header?.reason).toBe('initial')
    expect(header?.system?.text).toContain('test agent')
    expect(header?.config).toMatchObject({ provider: 'mock', model: 'mock-1' })

    const prompt = trajectory.records.find((record) => record.kind === 'user')
    expect(prompt?.summary).toBe('what is the answer')

    const message = trajectory.records.find((record) => record.kind === 'message')
    expect(message).toMatchObject({ provider: 'mock', model: 'mock-1', turn: 1, step: 1 })
    expect(message?.kind === 'message' && message.text.text).toBe('the answer')
    expect(message?.kind === 'message' && message.usage).toMatchObject({ input: 120, output: 4 })
  })

  it('measures a real TTFT strictly inside the step duration', async () => {
    const { runtime, sessionId } = await oneTurn()
    const trajectory = await runtime.trajectory(sessionId)
    expect(trajectory).not.toBeNull()
    if (trajectory === null) return

    const message = trajectory.records.find((record) => record.kind === 'message')
    const ttft = message?.kind === 'message' ? message.ttftMs : null
    expect(ttft).not.toBeNull()
    // The adapter stalls 30 ms before its first token, so a TTFT read off the
    // real chunk timestamps has to clear that and still fit inside the step.
    expect(ttft!).toBeGreaterThanOrEqual(25)
    expect(ttft!).toBeLessThanOrEqual(message!.durationMs!)
  })

  it('records the route and closes the turn as completed', async () => {
    const { runtime, sessionId } = await oneTurn()
    const trajectory = await runtime.trajectory(sessionId)
    expect(trajectory).not.toBeNull()
    if (trajectory === null) return

    expect(trajectory.requests).toHaveLength(1)
    expect(trajectory.requests[0]).toMatchObject({
      ordinal: 1,
      purpose: 'generation',
      // dsh numbers turns and steps from 1.
      turn: 1,
      step: 1,
      header: 0,
      route: { provider: 'mock', model: 'mock-1', contextWindow: 200_000 },
    })
    expect(trajectory.turns[0]).toMatchObject({ turn: 1, outcome: 'completed', steps: 1 })
    expect(trajectory.totals).toMatchObject({ input: 120, output: 4 })
  })

  it('projects a disposed session identically from its durable transcript', async () => {
    const { runtime, sessionId } = await oneTurn()
    const fromMemory = await runtime.trajectory(sessionId)
    expect(fromMemory).not.toBeNull()
    if (fromMemory === null) return

    // Dropping the agent releases the live session; the next read has to come
    // off disk, and the two projections have to agree on everything but liveness.
    await disposers.pop()?.()
    const fromDisk = await runtime.trajectory(sessionId)
    expect(fromDisk).not.toBeNull()
    if (fromDisk === null) return

    expect(fromDisk.live).toBe(false)
    expect(fromDisk.records.map((record) => [record.kind, record.summary]))
      .toEqual(fromMemory.records.map((record) => [record.kind, record.summary]))
    expect(fromDisk.totals).toEqual(fromMemory.totals)
    expect(fromDisk.headers).toEqual(fromMemory.headers)
  })

  it('answers absent for a session that has never run a turn', async () => {
    const { runtime } = await oneTurn()

    // A SuperOne session exists the moment the user opens it; its dsh session
    // does not exist until a turn runs. Reporting that as a read failure told
    // every user opening a fresh session that something had broken.
    expect(await runtime.trajectory(randomUUID())).toBeNull()
  })
})
