import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DeepseekRuntime } from './runtime'
import { listDeepseekPresets } from './presets'

/** The shipped preset root the desktop app ships through `extraResources`. */
const PRESET_ROOT = fileURLToPath(new URL('../../../apps/desktop/resources/agent-presets/', import.meta.url))

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

/** Boot a tree whose roster scans only the shipped root. */
async function rosterRuntime() {
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-preset-store-'))
  dirs.push(persistenceRoot)
  const runtime = await DeepseekRuntime.create({
    persona: 'test agent',
    persistenceRoot,
    presetRoot: PRESET_ROOT,
  })
  disposers.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new QuietAdapter())
  return runtime
}

/**
 * Run one turn on `preset` and read back the tool catalog the model was
 * actually sent, out of the `request/header` snapshot the session logged.
 */
async function catalogFor(runtime: DeepseekRuntime, preset: string): Promise<string[]> {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-preset-'))
  dirs.push(cwd)
  const sessionId = randomUUID()
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    agentPreset: preset,
    onEvent: () => undefined,
  })
  disposers.push(() => agent.dispose())

  agent.sendText('hello')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await agent.whenIdle()

  const trajectory = await runtime.trajectorySnapshot(sessionId)
  return (trajectory?.headers[0]?.tools ?? []).map((tool) => tool.name).sort()
}

/** Run one turn on an existing session id, optionally resuming it. */
async function turnOn(
  runtime: DeepseekRuntime,
  sessionId: string,
  cwd: string,
  options: { preset?: string; resume?: boolean } = {},
) {
  const agent = await runtime.createAgent({
    sessionId,
    cwd,
    provider: 'mock',
    model: 'mock-1',
    ...(options.preset ? { agentPreset: options.preset } : {}),
    ...(options.resume ? { resume: true } : {}),
    onEvent: () => undefined,
  })
  agent.sendText('hello')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await agent.whenIdle()
  return agent
}

describe('agent preset session identity', () => {
  it('recomposes a resumed session with the preset it actually ran on', async () => {
    const persistenceRoot = mkdtempSync(join(tmpdir(), 'dsh-preset-resume-'))
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-preset-resume-cwd-'))
    dirs.push(persistenceRoot, cwd)
    const sessionId = randomUUID()

    const first = await DeepseekRuntime.create({
      persona: 'test agent', persistenceRoot, presetRoot: PRESET_ROOT,
    })
    ;(first.context as unknown as {
      llm: { registerAdapter(p: string[], a: LlmAdapter): void }
    }).llm.registerAdapter(['mock'], new QuietAdapter())
    await (await turnOn(first, sessionId, cwd, { preset: 'minimal' })).dispose()
    await first.dispose()

    // A second tree with no memory of the first. Reading the creation header
    // alone would be enough here, but the roster default is `standard` — so a
    // resume that did not consult the log would silently hand this session a
    // catalog its history was never produced under.
    const second = await DeepseekRuntime.create({
      persona: 'test agent', persistenceRoot, presetRoot: PRESET_ROOT,
    })
    disposers.push(() => second.dispose())
    ;(second.context as unknown as {
      llm: { registerAdapter(p: string[], a: LlmAdapter): void }
    }).llm.registerAdapter(['mock'], new QuietAdapter())
    const resumed = await turnOn(second, sessionId, cwd, { resume: true })
    disposers.push(() => resumed.dispose())

    expect(second.sessionPreset(sessionId)).toBe('minimal')
    const trajectory = await second.trajectorySnapshot(sessionId)
    const catalog = (trajectory?.headers.at(-1)?.tools ?? []).map((tool) => tool.name).sort()
    expect(catalog).toEqual(['bash'])
  })

  it('switches a blank session and refuses one that has already run', async () => {
    const runtime = await rosterRuntime()
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-preset-switch-'))
    dirs.push(cwd)
    const sessionId = randomUUID()

    const agent = await runtime.createAgent({
      sessionId, cwd, provider: 'mock', model: 'mock-1',
      agentPreset: 'standard', onEvent: () => undefined,
    })
    disposers.push(() => agent.dispose())
    expect(runtime.sessionPreset(sessionId)).toBe('standard')

    await runtime.switchPreset(sessionId, 'minimal')
    expect(runtime.sessionPreset(sessionId)).toBe('minimal')

    agent.sendText('hello')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await agent.whenIdle()

    // Once a turn has opened, the switch is refused: swapping the catalog now
    // would strand the tool calls already in the log.
    await expect(runtime.switchPreset(sessionId, 'standard')).rejects.toThrow('already run a turn')
  })
})

describe('agent preset roster', () => {
  it('lists the four shipped presets in declared order', async () => {
    const runtime = await rosterRuntime()

    const presets = await listDeepseekPresets(runtime.context)

    expect(presets.map((preset) => preset.id)).toEqual(['standard', 'ptc', 'minimal', 'cordis'])
    // A broken preset stays on the roster with its reason; all four shipped
    // ones must compose, or every session on them fails at creation.
    expect(presets.filter((preset) => preset.broken !== null)).toEqual([])
    // The shipped declarations carry no display metadata; the renderer
    // translates shipped ids, so the projection falls back to the id.
    expect(presets[0]).toMatchObject({ id: 'standard', name: 'standard', description: null })
  })

  it('mounts every shipped preset', async () => {
    const runtime = await rosterRuntime()
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-preset-all-'))
    dirs.push(cwd)

    // Discovery health is a shape check — it proves the YAML parses and holds
    // named rows, not that every row's host service exists. Only a real mount
    // answers that, and it is per preset: `cordis` shipped broken for a while
    // because its `tool-cordis` row waited on services no other preset needs.
    for (const preset of ['standard', 'ptc', 'minimal', 'cordis']) {
      const agent = await runtime.createAgent({
        sessionId: randomUUID(), cwd, provider: 'mock', model: 'mock-1',
        agentPreset: preset, onEvent: () => undefined,
      })
      disposers.push(() => agent.dispose())
    }
  })

  it('sends the standard preset a full coding catalog', async () => {
    const runtime = await rosterRuntime()

    const catalog = await catalogFor(runtime, 'standard')

    // The rows this composition names have to survive the mount — a row still
    // waiting on a host service the deployment never supplies is exactly what
    // `mount()` refuses, and it would take the whole session with it.
    expect(catalog).toEqual(expect.arrayContaining([
      'bash', 'read', 'write', 'edit', 'glob', 'grep',
      'todo_write', 'subagent', 'subagent_fork',
    ]))
  })

  it('sends the minimal preset exactly its one tool', async () => {
    const runtime = await rosterRuntime()

    const catalog = await catalogFor(runtime, 'minimal')

    // This is the whole point of the preset mechanism: the same harness reaches
    // the model as a one-tool agent, with none of the standard catalog.
    expect(catalog).toEqual(['bash'])
  })

  it('keeps two sessions on different presets apart', async () => {
    const runtime = await rosterRuntime()

    const [standard, minimal] = [await catalogFor(runtime, 'standard'), await catalogFor(runtime, 'minimal')]

    // Both mounts are standing and live at once; a preset's registrations
    // reaching the other's agent would mean the scope parentage is wrong.
    expect(standard.length).toBeGreaterThan(minimal.length)
    expect(minimal).not.toContain('todo_write')
    expect(minimal).not.toContain('read')
  })
})
