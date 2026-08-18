import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime, type DeepseekAgentHandle } from './runtime'

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
  const runtime = await DeepseekRuntime.create({
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
  it('streams a text turn as message_start → deltas → usage → message_complete', async () => {
    const { runtime } = await bootRuntime()
    const events: AgentEvent[] = []
    const agent = await runTurn(runtime, events, 'hi there')

    const types = events.map((event) => event.type)
    expect(types).toContain('message_start')
    expect(types).toContain('content_delta')
    expect(types).toContain('message_usage')
    expect(types).toContain('message_complete')
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
