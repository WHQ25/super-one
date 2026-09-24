import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
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

/** The `subagent` tool's parameter names in the first request of a new session. */
async function subagentParameters(runtime: DeepseekRuntime, model: CatalogAdapter): Promise<string[]> {
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
  return Object.keys((tool?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {})
}

describe('subagent model selection', () => {
  it('is off by default and changes live for the sessions composed after', async () => {
    const { runtime, model } = await boot()
    // Read through the context each time: an update may restart the service.
    const current = () => runtime.context.get('subagentModelSelection')?.current()
    expect(current()).toEqual({ enabled: false, allowedModels: [] })
    expect(await subagentParameters(runtime, model)).not.toContain('model')

    await runtime.setSubagentModelSelection({ enabled: true, allowedModels: [{ provider: 'mock', model: 'mock-1' }] })

    await vi.waitFor(() => expect(current()).toEqual({ enabled: true, allowedModels: [{ provider: 'mock', model: 'mock-1' }] }))
    expect(await subagentParameters(runtime, model)).toContain('model')
  })
})
