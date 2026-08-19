import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'

class QuietAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
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
    return { provider, id: model, name: 'Mock One', context: { contextWindow: 200_000 } }
  }
}

const dirs: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/**
 * What the `cordis` preset actually registers, read off the catalog rather than
 * off the docs — the names depend on how the composition configures
 * `tool-cordis`, so the old bare host-plane mount produced a different set.
 */
const CORDIS_TOOLS = [
  'cordis_define',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine',
]

/** The tool catalog one preset actually sends the model. */
async function catalogFor(preset: string): Promise<string[]> {
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-cordis-store-'))
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-cordis-'))
  dirs.push(persistenceRoot, cwd)
  const runtime = await DeepseekRuntime.create({
    ...TEST_PRESET_OPTIONS,
    persona: 'test agent',
    persistenceRoot,
  })
  disposers.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new QuietAdapter())

  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId, cwd, provider: 'mock', model: 'mock-1', agentPreset: preset,
    onEvent: () => undefined,
  })
  disposers.push(() => agent.dispose())
  agent.sendText('hello')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await agent.whenIdle()

  const trajectory = await runtime.trajectory(sessionId)
  return (trajectory?.headers[0]?.tools ?? []).map((tool) => tool.name)
}

describe('dsh self-referential toolset', () => {
  it('reaches the model only through the cordis preset', async () => {
    // The runner and its inspect registry are host-plane services, so they are
    // mounted for every tree; the row that turns them into tools belongs to one
    // preset. Two `tool-cordis` instances cannot coexist — the second collides
    // on the inspect provider — which is why the preset is the only gate.
    expect(await catalogFor('cordis')).toEqual(expect.arrayContaining(CORDIS_TOOLS))
  })

  it('is absent from every other preset', async () => {
    const standard = await catalogFor('standard')

    expect(standard).not.toContain('cordis_define')
    // The rest of the standard catalog is untouched — this is one row, not a
    // different agent.
    expect(standard).toEqual(expect.arrayContaining(['bash', 'read', 'write']))
  })
})
