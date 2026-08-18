/**
 * The risk here is not MCP itself — it is placement: dsh's servers are
 * deployment-level, so they must reach every session of the tree, survive a
 * second session starting, and go away when the config drops them. These tests
 * mount a fake server plugin (same registration surface, no network) and assert
 * on the tools an agent can actually call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { DeepseekMcpServers, type DeepseekMcpServerSpec } from './mcp-servers'

class ToolCallAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
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

/**
 * Stands in for `dsh-mcp-client`: same contract that matters here — registers
 * `mcp__<serverName>__ping` on the context it is mounted on, and reserves
 * nothing globally so the test can observe our own name allocation.
 */
const fakeServerPlugin = {
  name: 'fake-mcp-client',
  inject: ['tools'],
  apply(ctx: Context, config: { serverName: string; url?: string }) {
    ;(ctx as Context & { tools: { register(definition: unknown): () => void } }).tools.register({
      name: `mcp__${config.serverName}__ping`,
      description: 'Reply with the server identity.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: (value as { text: string }).text }],
      },
      execute: async () => ({ text: `pong:${config.serverName}:${config.url ?? ''}` }),
    })
  },
}

const cleanups: Array<() => Promise<void> | void> = []

async function bootRuntime() {
  const runtime = await DeepseekRuntime.create({ persona: 'test agent' })
  cleanups.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new ToolCallAdapter())
  // Swap in the fake plugin: mounting the real client would need live servers.
  ;(runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers =
    new DeepseekMcpServers(runtime.context, fakeServerPlugin)
  return runtime
}

async function startAgent(
  runtime: DeepseekRuntime,
  cwd: string,
  mcpServers: DeepseekMcpServerSpec[],
) {
  const events: AgentEvent[] = []
  const agent = await runtime.createAgent({
    sessionId: randomUUID(),
    cwd,
    provider: 'mock',
    model: 'mock-1',
    onEvent: (event) => events.push(event),
    mcpServers,
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

const httpServer = (name: string, url: string): DeepseekMcpServerSpec =>
  ({ name, transport: 'streamable-http', url, headers: {} })

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

describe('third-party MCP servers', () => {
  it('reaches every session, because dsh composes per deployment', async () => {
    const runtime = await bootRuntime()
    const specs = [httpServer('repo', 'http://a')]
    const a = await startAgent(runtime, '/projects/a', specs)
    const b = await startAgent(runtime, '/projects/b', specs)

    await runTurn(a.agent, 'CALL mcp__repo__ping {}')
    await runTurn(b.agent, 'CALL mcp__repo__ping {}')

    // One mount, one name, both sessions — what the profile patch layer says.
    expect(toolResults(a.events)).toContain('pong:repo')
    expect(toolResults(b.events)).toContain('pong:repo')
  })

  it('mounts a server once even as sessions come and go', async () => {
    const runtime = await bootRuntime()
    const specs = [httpServer('repo', 'http://a')]
    const first = await startAgent(runtime, '/projects/a', specs)
    await first.agent.dispose()

    // A second mount under the same name would throw on the process-wide
    // reservation the real client keeps, so this is the regression that matters.
    const second = await startAgent(runtime, '/projects/a', specs)
    await runTurn(second.agent, 'CALL mcp__repo__ping {}')

    expect(toolResults(second.events)).toContain('pong:repo:http://a')
  })

  it('re-mounts when the config changed and drops what is gone', async () => {
    const runtime = await bootRuntime()
    const first = await startAgent(runtime, '/projects/a', [httpServer('repo', 'http://a')])
    await first.agent.dispose()

    const second = await startAgent(runtime, '/projects/a', [httpServer('repo', 'http://b')])
    await runTurn(second.agent, 'CALL mcp__repo__ping {}')

    // Same name, new endpoint: the old mount had to go before the new one
    // could take the name back.
    expect(toolResults(second.events)).toContain('pong:repo:http://b')
  })

  it('leaves a session with no configured servers alone', async () => {
    const runtime = await bootRuntime()
    const sync = vi.spyOn(
      (runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers,
      'sync',
    )
    const { agent } = await startAgent(runtime, '/projects/a', [])

    await runTurn(agent, 'hello')

    expect(sync).toHaveBeenCalledWith([])
  })
})
