import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DeepseekRuntime } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'
import { ToolCallAdapter } from './test-adapters'

/** Also keeps the tool catalog each request offered. */
class CatalogAdapter extends ToolCallAdapter {
  readonly catalogs: GenerateOptions['tools'][] = []

  override stream(options: GenerateOptions) {
    this.catalogs.push(options.tools)
    return super.stream(options)
  }
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
})

async function boot() {
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  disposers.push(() => runtime.dispose())
  const model = new CatalogAdapter()
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: CatalogAdapter): void }
  }).llm.registerAdapter(['mock'], model)
  return { runtime, model }
}

/** Session authorization and the tool's model-selection fields are separate. */
async function subagentParameters(runtime: DeepseekRuntime, model: CatalogAdapter): Promise<{ parameters: string[]; policy: unknown }> {
  const agent = await runtime.createAgent({
    sessionId: randomUUID(),
    cwd: process.cwd(),
    provider: 'mock',
    model: 'mock-1',
    onEvent: () => {},
  })
  disposers.push(() => agent.dispose())
  model.catalogs.length = 0
  await agent.sendText('hello')
  await new Promise((resolve) => setTimeout(resolve, 50))
  await agent.whenIdle()
  const tool = (model.catalogs[0] ?? []).find((candidate) => candidate.name === 'subagent')
  const session = runtime.context.get('sessions')!.get(SessionId(agent.sessionId))!
  // Upstream's policy event declaration is internal to its published package.
  const events: readonly { type: string; data: unknown }[] = session.snapshotEvents()
  const policy = events.find((event) => event.type === 'subagent/model-selection-policy')?.data
  return { parameters: Object.keys((tool?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}), policy }
}

describe('subagent model selection', () => {
  it('rejects a model-authored independent route without recorded authorization', async () => {
    const { runtime, model } = await boot()
    const agent = await runtime.createAgent({
      sessionId: randomUUID(), cwd: process.cwd(), provider: 'mock', model: 'mock-1', onEvent: () => {},
    })
    disposers.push(() => agent.dispose())
    await agent.sendText('CALL subagent {"description":"choose another model","prompt":"hello","provider":"mock","model":"mock-2"}')
    await new Promise((resolve) => setTimeout(resolve, 50))
    await agent.whenIdle()
    expect(model.toolResults.flat().join('\n')).toContain('not allowed for this Session')
  })

  it('is off by default and changes live for the sessions composed after', async () => {
    const { runtime, model } = await boot()
    const before = await subagentParameters(runtime, model)
    expect(before.parameters).toContain('model')
    expect(before.policy).toBeUndefined()

    await runtime.setSubagentModelSelection({ enabled: true, allowedModels: [{ provider: 'mock', model: 'mock-1' }] })

    const after = await subagentParameters(runtime, model)
    expect(after.parameters).toContain('model')
    expect(after.policy).toEqual({ allowedModels: [{ provider: 'mock', model: 'mock-1' }] })
  })
})
