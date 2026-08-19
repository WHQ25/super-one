import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime, type DeepseekAgentHandle } from './runtime'
import { TEST_PRESET_OPTIONS } from './test-presets'

/**
 * Scripted adapter keyed on the whole message list — not the last message:
 * dsh appends a runtime-context snapshot after the user prompt, so the tail is
 * never the caller's text.
 */
class MockAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const allText = JSON.stringify(options.messages)
    if (allText.includes('tool-result')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'tool done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'tool done' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (allText.includes('TOOL')) {
      const id = `call-${randomUUID().slice(0, 8)}`
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: id as never, name: 'ping', argumentsDelta: '{}' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: id as never, name: 'ping', arguments: '{}' },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'hello ' }
    yield { type: 'text-delta', index: 0, text: 'world' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'hello world' } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
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

async function bootRuntime(opts?: { onApproval?: () => Promise<'allowed-once' | 'rejected' | 'cancelled'> }) {
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS,
    persona: 'test agent',
    ...(opts?.onApproval ? { onApproval: opts.onApproval } : {}),
  })
  const ctx = runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
    tools: { register(definition: unknown): () => void }
    on(event: string, handler: (...args: never[]) => unknown): () => void
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter())
  return { runtime, ctx }
}

async function runTurn(
  runtime: DeepseekRuntime,
  events: AgentEvent[],
  text: string,
  existing?: DeepseekAgentHandle,
): Promise<DeepseekAgentHandle> {
  const agent = existing ?? await runtime.createAgent({
    sessionId: randomUUID(),
    cwd: process.cwd(),
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
  })
  agent.sendText(text)
  // whenIdle resolves at driver quiescence — after turn/end and status idle.
  await new Promise((resolve) => setTimeout(resolve, 50))
  await agent.whenIdle()
  return agent
}

describe('deepseek runtime end-to-end (mock adapter)', () => {
  it('preserves configured model display names in the live catalog', async () => {
    const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS,
      persona: 'test agent',
      deepseekAdapter: {
        models: [
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 128_000 },
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128_000 },
        ],
      },
    })

    await expect(runtime.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }),
      expect.objectContaining({ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }),
    ])

    await runtime.dispose()
  })

  it('carries each model’s reasoning efforts, which the advisory listing omits', async () => {
    const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS,
      persona: 'test agent',
      deepseekAdapter: { models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }] },
    })

    const [model] = await runtime.listModels()
    // `ctx.llm.listModels` never carries these — they only exist on the exact
    // route resolved by the owning adapter, which is the whole point of the
    // second call this method makes.
    expect(model.reasoningEfforts).toEqual(['off', 'low', 'high', 'max'])
    expect(model.defaultReasoningEffort).toBe('high')

    await runtime.dispose()
  })

  it('advertises only `off` when the deployment disables thinking', async () => {
    const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS,
      persona: 'test agent',
      deepseekAdapter: {
        models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }],
        thinking: 'disabled',
      },
    })

    const [model] = await runtime.listModels()
    expect(model.reasoningEfforts).toEqual(['off'])

    await runtime.dispose()
  })

  it('keeps a model whose route will not resolve, minus its efforts', async () => {
    const { runtime, ctx } = await bootRuntime()
    // The mock adapter lists `mock-1` but this stub refuses to resolve it —
    // an unknown capability must cost the model its efforts, not its seat in
    // the picker.
    const llm = ctx.llm as unknown as {
      resolveModelInfo(provider: string, model: string): Promise<unknown>
    }
    llm.resolveModelInfo = () => Promise.reject(new Error('adapter offline'))

    await expect(runtime.listModels()).resolves.toEqual([
      expect.objectContaining({ id: 'mock-1', reasoningEfforts: [] }),
    ])

    await runtime.dispose()
  })

  it('streams a text turn as message_start → deltas → usage → message_complete', async () => {
    const { runtime } = await bootRuntime()
    const events: AgentEvent[] = []
    const agent = await runTurn(runtime, events, 'hi there')

    const types = events.map((event) => event.type)
    expect(types).toContain('message_start')
    expect(types).toContain('content_delta')
    expect(types).toContain('message_usage')
    expect(types).toContain('message_complete')
    const messageStart = events.find((event) => event.type === 'message_start')
    expect(messageStart?.type === 'message_start' ? messageStart.message.providerId : undefined).toBe('dsh')
    // The context ring feeds off this pair (shared usage reducer contract).
    const usage = events.find((event) => event.type === 'message_usage')
    expect(usage && 'contextTokens' in usage ? usage.contextTokens : undefined).toBeGreaterThan(0)
    const text = events
      .filter((event) => event.type === 'content_delta')
      .map((event) => (event.delta.type === 'text' ? event.delta.text : ''))
      .join('')
    expect(text).toBe('hello world')
    expect(types.indexOf('message_start')).toBeLessThan(types.indexOf('message_complete'))

    await agent.dispose()
    await runtime.dispose()
  })

  it('runs a guarded tool call through the approval seam and maps tool blocks', async () => {
    let approvalAsked = false
    const { runtime, ctx } = await bootRuntime({
      onApproval: async () => {
        approvalAsked = true
        return 'allowed-once'
      },
    })
    let toolRan = false
    ctx.tools.register({
      name: 'ping',
      description: 'Reply pong.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      async execute() {
        toolRan = true
        return 'pong'
      },
    })
    ctx.on('tools/pre-execute', (async (exec: { name: string }, next: () => Promise<unknown>) => {
      if (exec.name === 'ping') return { kind: 'ask', reason: 'test approval' }
      return next()
    }) as never)

    const events: AgentEvent[] = []
    const agent = await runTurn(runtime, events, 'please TOOL now')

    expect(approvalAsked).toBe(true)
    expect(toolRan).toBe(true)
    const toolUse = events.find(
      (event) => event.type === 'content_delta' && event.delta.type === 'tool_use',
    )
    const toolResult = events.find(
      (event) => event.type === 'content_delta' && event.delta.type === 'tool_result',
    )
    expect(toolUse).toBeDefined()
    expect(toolResult).toBeDefined()
    // The tool forces a second model round trip, and dsh opens a step for it.
    // That is invisible to the user: one thing was asked, so one bubble with
    // one token footer answers it.
    expect(events.filter((event) => event.type === 'message_start')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'message_complete')).toHaveLength(1)
    expect(toolUse?.type === 'content_delta' ? toolUse.messageId : undefined)
      .toBe(toolResult?.type === 'content_delta' ? toolResult.messageId : 'unmatched')

    await agent.dispose()
    await runtime.dispose()
  })

  it('maps user cancel onto message_interrupted', async () => {
    const { runtime, ctx } = await bootRuntime()
    // Slow adapter route so cancel lands mid-stream.
    ctx.llm.registerAdapter(['slow'], new (class extends MockAdapter {
      override async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        for (let i = 0; i < 50; i++) {
          yield { type: 'text-delta', index: 0, text: `t${i} ` }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })())

    const events: AgentEvent[] = []
    const agent = await runtime.createAgent({
      sessionId: randomUUID(),
      cwd: process.cwd(),
      provider: 'slow',
      model: 'mock-1',
      onEvent: (event) => events.push(event),
    })
    agent.sendText('go')
    await new Promise((resolve) => setTimeout(resolve, 150))
    agent.cancel()
    await agent.whenIdle()

    expect(events.map((event) => event.type)).toContain('message_interrupted')

    await agent.dispose()
    await runtime.dispose()
  })
})
