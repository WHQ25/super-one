/**
 * The risk here is not MCP — it is dsh's scoping: whether a project's servers
 * reach that project's agents and nobody else's, and whether one process-wide
 * `serverName` namespace can hold two projects at once. So these tests mount a
 * fake server plugin (same registration surface, no network) and assert on the
 * tools each agent can actually call.
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

const httpServer = (
  name: string,
  scope: 'user' | 'project',
  url: string,
): DeepseekMcpServerSpec => ({ name, scope, transport: 'streamable-http', url, headers: {} })

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

describe('third-party MCP servers', () => {
  it('reaches only the agents chained to that project scope', async () => {
    const runtime = await bootRuntime()
    const a = await startAgent(runtime, '/projects/a', [httpServer('repo', 'project', 'http://a')])
    const b = await startAgent(runtime, '/projects/b', [httpServer('other', 'project', 'http://b')])

    await runTurn(a.agent, 'CALL mcp__repo__ping {}')
    await runTurn(b.agent, 'CALL mcp__repo__ping {}')

    expect(toolResults(a.events)).toContain('pong:repo')
    // Project B never chained to project A's scope, so the tool is not there.
    expect(toolResults(b.events)).toContain('unknown tool')
  })

  it('shares a user-scope server with every project', async () => {
    const runtime = await bootRuntime()
    const shared = httpServer('shared', 'user', 'http://shared')
    const a = await startAgent(runtime, '/projects/a', [shared])
    const b = await startAgent(runtime, '/projects/b', [shared])

    await runTurn(a.agent, 'CALL mcp__shared__ping {}')
    await runTurn(b.agent, 'CALL mcp__shared__ping {}')

    // One mount, one name, both sessions — the config's own semantics.
    expect(toolResults(a.events)).toContain('pong:shared')
    expect(toolResults(b.events)).toContain('pong:shared')
  })

  it('keeps the plain name for one project and renames only the clashing config', async () => {
    const runtime = await bootRuntime()
    const a = await startAgent(runtime, '/projects/a', [httpServer('repo', 'project', 'http://a')])
    const b = await startAgent(runtime, '/projects/b', [httpServer('repo', 'project', 'http://b')])

    await runTurn(a.agent, 'CALL mcp__repo__ping {}')
    await runTurn(b.agent, 'CALL mcp__repo-2__ping {}')

    expect(toolResults(a.events)).toContain('pong:repo:http://a')
    // Same name, different config: the second one cannot hold the process-wide
    // reservation, so it is mounted under a numbered variant instead of lost.
    expect(toolResults(b.events)).toContain('pong:repo-2:http://b')
  })

  it('frees the name once the last session in that project goes away', async () => {
    const runtime = await bootRuntime()
    const first = await startAgent(runtime, '/projects/a', [httpServer('repo', 'project', 'http://a')])
    await first.agent.dispose()

    const second = await startAgent(runtime, '/projects/b', [httpServer('repo', 'project', 'http://b')])
    await runTurn(second.agent, 'CALL mcp__repo__ping {}')

    expect(toolResults(second.events)).toContain('pong:repo:http://b')
  })

  it('leaves sessions with no servers unchained', async () => {
    const runtime = await bootRuntime()
    const acquire = vi.spyOn(
      (runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers,
      'acquire',
    )
    const { agent } = await startAgent(runtime, '/projects/a', [])

    await runTurn(agent, 'hello')

    expect(acquire).not.toHaveBeenCalled()
  })
})
