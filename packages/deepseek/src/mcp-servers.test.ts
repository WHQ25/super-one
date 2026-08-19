/**
 * The risk here is not MCP itself — it is placement: dsh's servers are
 * deployment-level, so they must reach every session of the tree, survive a
 * second session starting, and go away when the config drops them. These tests
 * drive the REAL `ctx.loader` entry tree and register a fake server plugin as a
 * `cordis:` builtin (same registration surface, no network), so the loader path
 * under test is the one production uses — only the module behind the specifier
 * differs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AgentEvent } from '@superone/shared/agent-types'
import { DeepseekRuntime } from './runtime'
import { DeepseekMcpServers, DSH_MCP_CLIENT_SPECIFIER, type DeepseekMcpServerSpec } from './mcp-servers'
import { TEST_PRESET_OPTIONS } from './test-presets'

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
const FAKE_BUILTIN_KEY = 'superone-test-mcp-client'

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
  const runtime = await DeepseekRuntime.create({ ...TEST_PRESET_OPTIONS, persona: 'test agent' })
  cleanups.push(() => runtime.dispose())
  ;(runtime.context as unknown as {
    llm: { registerAdapter(providers: string[], adapter: LlmAdapter): void }
  }).llm.registerAdapter(['mock'], new ToolCallAdapter())
  // Register the fake behind a `cordis:` specifier — the loader's own escape
  // hatch for modules that are not on disk. Mounting the real client would
  // need live servers.
  const loader = (runtime.context as unknown as {
    get(name: string): { builtins: Record<string, unknown> }
  }).get('loader')
  loader.builtins[FAKE_BUILTIN_KEY] = fakeServerPlugin
  ;(runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers =
    new DeepseekMcpServers(runtime.context, `cordis:${FAKE_BUILTIN_KEY}`)
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

  // Every other test here swaps in a `cordis:` builtin, which would keep
  // passing if the real package were renamed or dropped from the manifest.
  // This one drives the production specifier through the real create path. The
  // server is deliberately unreachable: `failOnStartupError: false` means a
  // dead endpoint costs its own tools and nothing else, so an entry that
  // survives proves the module RESOLVED — which is the thing under test.
  it('resolves the real dsh-mcp-client through the loader', async () => {
    const runtime = await bootRuntime()
    const servers = new DeepseekMcpServers(runtime.context, DSH_MCP_CLIENT_SPECIFIER)
    cleanups.push(() => servers.dispose())
    const loader = (runtime.context as unknown as {
      get(name: string): { store: Record<string, unknown> }
    }).get('loader')

    await servers.sync([httpServer('probe', 'http://127.0.0.1:1')])

    // A bad specifier throws inside `loader.create`, which the registrar
    // swallows — so the entry would simply be absent.
    expect(Object.keys(loader.store)).toContain('mcp-probe')
  })

  // The reason this registrar went through `ctx.loader` at all: dsh reserves
  // `serverName` process-wide, so an edited server must restart its own row
  // rather than disappear and re-take the name.
  it('restarts a changed server in place instead of dropping its entry', async () => {
    const runtime = await bootRuntime()
    const servers = (runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers
    const loader = (runtime.context as unknown as {
      get(name: string): { store: Record<string, unknown>; update: unknown }
    }).get('loader')
    const updates = vi.spyOn(loader as unknown as { update: (...args: never[]) => Promise<void> }, 'update')
    const removes = vi.spyOn(loader as unknown as { remove: (...args: never[]) => Promise<void> }, 'remove')

    await servers.sync([httpServer('repo', 'http://a')])
    // Entry ids follow dsh's own patch-file convention, so a running tree reads
    // like the file the user edits.
    expect(Object.keys(loader.store)).toContain('mcp-repo')

    await servers.sync([httpServer('repo', 'http://b')])

    expect(updates).toHaveBeenCalledTimes(1)
    expect(removes).not.toHaveBeenCalled()
    expect(Object.keys(loader.store)).toContain('mcp-repo')

    // ...and an unchanged re-sync is a no-op, not a pointless restart.
    await servers.sync([httpServer('repo', 'http://b')])
    expect(updates).toHaveBeenCalledTimes(1)
  })

  it('drops the loader entry when the server leaves the config', async () => {
    const runtime = await bootRuntime()
    const servers = (runtime as unknown as { mcpServers: DeepseekMcpServers }).mcpServers
    const loader = (runtime.context as unknown as {
      get(name: string): { store: Record<string, unknown> }
    }).get('loader')

    await servers.sync([httpServer('repo', 'http://a')])
    await servers.sync([])

    expect(Object.keys(loader.store)).not.toContain('mcp-repo')
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
