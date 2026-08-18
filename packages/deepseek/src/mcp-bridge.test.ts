/**
 * Driven against a real `McpServer` over a linked in-memory transport: the
 * bridge's own logic — discovery, public naming, the argument round trip, and
 * how the permission gate treats host-owned vs. ordinary MCP tools — is what
 * breaks, and none of it is HTTP-specific. The Streamable-HTTP wiring itself is
 * the shared `getSuperoneMcpHttpConfig` path every other harness already uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { publicToolName } from './mcp-bridge'

class ToolCallAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const transcript = JSON.stringify(options.messages)
    const call = /CALL ([\w-]+) (\{.*?\})(?=["\\])/.exec(transcript)
    if (!call || transcript.includes('"tool-result"')) {
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

/** A minimal SuperOne-shaped MCP server: one host-owned tool, one that is not. */
function connectMcpServer(): () => Transport {
  const server = new McpServer({ name: 'superone-test', version: '1.0.0' })
  server.registerTool(
    'project_list',
    { description: 'List projects.', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'project-a' }] }),
  )
  server.registerTool(
    'echo',
    { description: 'Echo text.', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text', text: `echo:${text}` }] }),
  )
  cleanups.push(() => server.close())

  return () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    void server.connect(serverTransport)
    return clientTransport
  }
}

async function startAgent(createTransport: () => Transport, ask: () => Promise<'allowed-once'>) {
  const runtime = await DeepseekRuntime.create({ persona: 'test agent' })
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
    toolPlane: {
      cwd: process.cwd(),
      mcp: {
        serverName: 'superone',
        url: 'http://127.0.0.1/unused',
        headers: {},
        createTransport,
      },
      requestPermission: ask as never,
    },
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

describe('superone MCP bridge', () => {
  it('qualifies names the way the rest of SuperOne matches on', () => {
    expect(publicToolName('superone', 'browser_click')).toBe('mcp__superone__browser_click')
  })

  it('runs a host-owned tool without a prompt', async () => {
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(connectMcpServer(), ask)

    await runTurn(agent, 'CALL mcp__superone__project_list {}')

    // Host-owned: admitted here so its own executor owns the authorization.
    expect(ask).not.toHaveBeenCalled()
    expect(toolResults(events)).toContain('project-a')
  })

  it('still asks for an MCP tool that is not host-owned', async () => {
    const ask = vi.fn(async () => 'allowed-once' as const)
    const { agent, events } = await startAgent(connectMcpServer(), ask)

    await runTurn(agent, 'CALL mcp__superone__echo {"text":"hi"}')

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'mcp__superone__echo',
      input: expect.objectContaining({ text: 'hi' }),
    }))
    expect(toolResults(events)).toContain('echo:hi')
  })
})
