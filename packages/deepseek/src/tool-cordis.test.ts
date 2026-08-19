import { afterEach, describe, expect, it } from 'vitest'
import { DeepseekRuntime } from './runtime'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length) await disposers.pop()?.().catch(() => undefined)
})

async function boot(toolCordis?: boolean) {
  const runtime = await DeepseekRuntime.create({ persona: 'test agent', ...(toolCordis !== undefined ? { toolCordis } : {}) })
  disposers.push(() => runtime.dispose())
  return runtime
}

/**
 * The model-visible tool names on the host plane. dsh assembles the request's
 * tool list from this registry, so it is also the answer to "what can the model
 * call on the next turn".
 */
function toolNames(runtime: DeepseekRuntime): string[] {
  const tools = (runtime.context as unknown as {
    tools: { schemas(): Array<{ name: string }> }
  }).tools
  return tools.schemas().map((schema) => schema.name)
}

/**
 * What `0.1.0-rc.7` actually registers. The package README still describes a
 * single `cordis_inspect`; the shipped build splits it three ways, so this list
 * is read off the registry rather than off the docs.
 */
const CORDIS_TOOLS = [
  'cordis_inspect_list',
  'cordis_inspect_query',
  'cordis_inspect_self',
  'cordis_define',
  'cordis_run',
  'cordis_stop',
  'cordis_undefine',
]

describe('dsh self-referential toolset opt-in', () => {
  it('is absent by default', async () => {
    const runtime = await boot()

    expect(runtime.toolCordisEnabled).toBe(false)
    expect(toolNames(runtime)).not.toContain('cordis_define')
    // The file and shell tools are unaffected — this is one row, not a mode.
    expect(toolNames(runtime)).toContain('bash')
  })

  it('mounts at boot when the user already opted in', async () => {
    const runtime = await boot(true)

    expect(runtime.toolCordisEnabled).toBe(true)
    expect(toolNames(runtime)).toEqual(expect.arrayContaining(CORDIS_TOOLS))
  })

  /**
   * The reason this is a live mount rather than a boot flag: the tree is one
   * per app lifetime, and what the switch withdraws is the model's ability to
   * run code in this process. "Restart to apply" would be the wrong contract
   * for an off switch.
   */
  it('appears and disappears while the tree runs', async () => {
    const runtime = await boot()

    await runtime.setToolCordisEnabled(true)
    expect(toolNames(runtime)).toEqual(expect.arrayContaining(CORDIS_TOOLS))

    await runtime.setToolCordisEnabled(false)
    expect(runtime.toolCordisEnabled).toBe(false)
    for (const name of CORDIS_TOOLS) expect(toolNames(runtime)).not.toContain(name)
  })

  it('is idempotent, because the settings handler calls it on every change', async () => {
    const runtime = await boot()

    await runtime.setToolCordisEnabled(true)
    await runtime.setToolCordisEnabled(true)
    await runtime.setToolCordisEnabled(false)
    await runtime.setToolCordisEnabled(false)

    expect(runtime.toolCordisEnabled).toBe(false)
    expect(toolNames(runtime)).not.toContain('cordis_define')
  })
})
