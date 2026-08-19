import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { superoneToolName, type SuperoneToolSurface } from './tool-surface'
import { TEST_PRESET_OPTIONS } from './test-presets'

/** `CALL <tool> <json>` in the prompt emits exactly that tool call. */
class ToolCallAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
    // Answer the LAST sentinel, and only while it is still unanswered — this
    // agent lives across several turns, so "a tool result exists" is not the
    // same as "this call already ran".
    const calls = [...transcript.matchAll(/CALL ([\w-]+) (\{.*?\})(?=["\\])/g)]
    const answered = transcript.split('"tool-result"').length - 1
    const call = calls.length > answered ? calls[calls.length - 1] : undefined
    if (!call) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const [, name, rawArgs] = call
    const args = rawArgs.replace(/\\"/g, '"')
    const id = `call-${randomUUID().slice(0, 8)}`
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: id as never, name, argumentsDelta: args }
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: id as never, name, arguments: args },
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
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

const cleanups: Array<() => Promise<void> | void> = []

/** SuperOne's tool plane, faked at the seam the desktop implements. */
function fakeSurface(): SuperoneToolSurface & {
  setTools(names: string[]): void
  calls: Array<{ name: string; args: Record<string, unknown> }>
} {
  let names = ['project_list', 'widget_show']
  let notify: (() => void) | undefined
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    setTools(next) {
      names = next
      notify?.()
    },
    list: () => names.map((name) => ({
      name,
      description: `${name} description`,
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    })),
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'broken') return { content: [{ type: 'text', text: 'boom' }], isError: true }
      return { content: [{ type: 'text', text: `ran:${name}` }] }
    },
    onChanged: (listener) => {
      notify = listener
      return () => { notify = undefined }
    },
  }
}

async function startAgent(surface: SuperoneToolSurface, ask: () => Promise<'allowed-once'>) {
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  cleanups.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new ToolCallAdapter())

  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId: randomUUID(),
    cwd: process.cwd(),
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    toolPlane: { superoneTools: surface, requestPermission: ask as never },
  })
  cleanups.push(() => agent.dispose())
  return { agent, events }
}

async function runTurn(agent: { sendText(text: string): void; whenIdle(): Promise<void> }, text: string) {
  agent.sendText(text)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await agent.whenIdle()
}

function toolResults(events: AgentEvent[]): string {
  return events
    .filter((event) => event.type === 'content_delta' && event.delta.type === 'tool_result')
    .map((event) => JSON.stringify(event.type === 'content_delta' ? event.delta : {}))
    .join('\n')
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

describe('superone native tool surface', () => {
  it('keeps the qualified name the rest of SuperOne matches on', () => {
    expect(superoneToolName('browser_click')).toBe('mcp__superone__browser_click')
  })

  it('runs a host-owned tool in process without a prompt', async () => {
    const surface = fakeSurface()
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(surface, ask)

    await runTurn(agent, 'CALL mcp__superone__project_list {"q":"x"}')

    // Host-owned: admitted here so the tool's own executor owns authorization.
    expect(ask).not.toHaveBeenCalled()
    // The raw bare name reaches the executor; the qualified one is model-facing.
    expect(surface.calls).toEqual([{ name: 'project_list', args: { q: 'x' } }])
    expect(toolResults(events)).toContain('ran:project_list')
  })

  it('surfaces an executor error as an error result instead of output', async () => {
    const surface = fakeSurface()
    surface.setTools(['broken'])
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(surface, ask)

    await runTurn(agent, 'CALL mcp__superone__broken {}')

    expect(toolResults(events)).toContain('"isError":true')
  })

  // The MCP bridge this replaced ignored tools/list_changed, so a mini-app
  // registered mid-session stayed invisible until the session restarted.
  it('picks up a tool added mid-session', async () => {
    const surface = fakeSurface()
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(surface, ask)

    await runTurn(agent, 'CALL mcp__superone__miniapp_call {}')
    expect(toolResults(events)).toContain('unknown tool')

    surface.setTools(['project_list', 'miniapp_call'])
    const later: AgentEvent[] = []
    events.length = 0
    await runTurn(agent, 'CALL mcp__superone__miniapp_call {}')
    later.push(...events)

    expect(toolResults(later)).toContain('ran:miniapp_call')
  })
})
