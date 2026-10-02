import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpAppsProvider, McpToolDescriptor } from '@superone/shared/mcp-apps'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { Session } from '../session/types'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } }))

const { registerMcpAppMentionIpc } = await import('./mention-search-ipc')

const mentionTool: McpToolDescriptor = {
  name: 'search_mentions', serverInfo: { title: 'Bits & Bolts' },
  _meta: { 'openai/extensions': { 'mentions/search': {} }, ui: { visibility: ['app'] } },
}
const event = { senderFrame: 'main', sender: { mainFrame: 'main' } }

function session(servers: Record<string, { tools?: McpToolDescriptor[] | Error; call?: (args: unknown) => unknown; read?: (uri: string, transient?: boolean) => unknown }>) {
  const calls: Array<{ server: string; args: unknown }> = []
  const value = {
    getMcpAppsHostBindings: vi.fn(async () => Object.keys(servers).map(server => ({ binding: { server }, origin: { providerSessionId: 't' } }))),
    getMcpAppsProvider: vi.fn(async ({ server }: { server: string }) => {
      const spec = servers[server]
      return {
        tools: async () => {
          if (spec.tools instanceof Error) throw spec.tools
          return new Map((spec.tools ?? []).map(tool => [tool.name, tool]))
        },
        callTool: async ({ args }: { args: unknown }) => {
          calls.push({ server, args })
          return { result: await spec.call!(args), outcome: 'completed' }
        },
        readResource: async ({ uri, transient }: { uri: string; transient?: boolean }) => spec.read!(uri, transient),
        dispose: () => {},
      } as unknown as McpAppsProvider
    }),
  }
  return { session: value as unknown as Session, calls }
}

async function search(target: Session | null, query: string, projectPath = '/work') {
  handlers.clear()
  registerMcpAppMentionIpc(() => target, () => { if (!target) throw new Error('missing'); return target })
  return handlers.get(AgentIpcChannels.MCP_APP_MENTION_SEARCH)!(event, projectPath, 'session-1', query)
}

describe('MCP mention search IPC', () => {
  beforeEach(() => handlers.clear())

  it('asks only mentions/search tools, ignoring model visibility', async () => {
    const { session: target, calls } = session({
      bits: { tools: [mentionTool, { name: 'cad.library' }], call: () => ({ content: [], structuredContent: { items: [{ type: 'resource_link', uri: 'cad://a', name: 'a', title: 'Part A' }] } }) },
      other: { tools: [{ name: 'plain' }] },
    })
    expect(await search(target, 'hex')).toEqual({ ok: true, value: { sources: [
      { server: 'bits', tool: 'search_mentions', title: 'Bits & Bolts', items: [{ uri: 'cad://a', label: 'Part A', detail: 'a' }] },
    ] } })
    expect(calls).toEqual([{ server: 'bits', args: { query: 'hex' } }])
  })

  it('reports a failing server per section and a silent one as incomplete', async () => {
    const { session: target } = session({
      bad: { tools: [mentionTool], call: () => ({ content: [], isError: true }) },
      down: { tools: new Error('not started') },
    })
    expect(await search(target, '')).toEqual({ ok: true, value: { incomplete: true, sources: [
      { server: 'bad', tool: 'search_mentions', title: 'Bits & Bolts', items: [], failed: true },
    ] } })
  })

  it('caps the query and answers remote projects and missing sessions without asking', async () => {
    const { session: target, calls } = session({ bits: { tools: [mentionTool], call: () => ({ content: [], structuredContent: { items: [] } }) } })
    await search(target, 'x'.repeat(500))
    expect((calls[0].args as { query: string }).query).toHaveLength(200)
    expect(await search(target, 'a', 'remote:node-1:/work')).toMatchObject({ ok: true, value: { sources: [], unavailable: 'remote' } })
    expect(await search(null, 'a')).toEqual({ ok: true, value: { sources: [] } })
  })

  it('refuses requests from a subframe', async () => {
    const { session: target } = session({})
    handlers.clear()
    registerMcpAppMentionIpc(() => target, () => target)
    const result = await handlers.get(AgentIpcChannels.MCP_APP_MENTION_SEARCH)!({ senderFrame: 'child', sender: { mainFrame: 'main' } }, '/work', 's', 'a')
    expect(result).toMatchObject({ ok: false, error: { code: 'denied' } })
  })
})

describe('MCP mention read IPC', () => {
  const read = (target: Session | null, targets: unknown, projectPath = '/work') => {
    handlers.clear()
    registerMcpAppMentionIpc(() => target, () => { if (!target) throw new Error('missing'); return target })
    return handlers.get(AgentIpcChannels.MCP_APP_MENTION_READ)!(event, projectPath, 'session-1', targets)
  }

  it('reads text transiently, caps it, skips binary and failures, and dedupes', async () => {
    const long = 'x'.repeat(25_000)
    const { session: target } = session({
      bits: { read: (uri, transient) => {
        if (!transient) throw new Error('must be transient')
        if (uri === 'cad://text') return { contents: [{ uri, mimeType: 'text/markdown', text: '# A' }, { uri, text: 'more' }] }
        if (uri === 'cad://long') return { contents: [{ uri, text: long }] }
        if (uri === 'cad://bin') return { contents: [{ uri, blob: 'AAAA', mimeType: 'model/stl' }] }
        throw new Error('gone')
      } },
    })
    const result = await read(target, [
      { server: 'bits', uri: 'cad://text' }, { server: 'bits', uri: 'cad://text' }, { server: 'bits', uri: 'cad://long' },
      { server: 'bits', uri: 'cad://bin' }, { server: 'bits', uri: 'cad://gone' }, { server: 'other', uri: 'x://1' },
    ]) as { ok: true; value: Array<Record<string, unknown>> }
    expect(result.value).toEqual([
      { server: 'bits', uri: 'cad://text', mimeType: 'text/markdown', text: '# A\n\nmore' },
      { server: 'bits', uri: 'cad://long', text: 'x'.repeat(20_000), truncated: true },
      { server: 'bits', uri: 'cad://bin', skipped: 'binary' },
      { server: 'bits', uri: 'cad://gone', skipped: 'failed' },
      { server: 'other', uri: 'x://1', skipped: 'failed' },
    ])
  })

  it('stops inlining once the message budget is spent', async () => {
    const { session: target } = session({ bits: { read: (uri) => ({ contents: [{ uri, text: 'y'.repeat(20_000) }] }) } })
    const result = await read(target, [1, 2, 3, 4].map(i => ({ server: 'bits', uri: `cad://${i}` }))) as { ok: true; value: Array<Record<string, unknown>> }
    expect(result.value.map(resource => resource.skipped ?? 'read')).toEqual(['read', 'read', 'read', 'budget'])
  })

  it('answers remote projects, missing sessions and malformed requests without reading', async () => {
    const { session: target } = session({ bits: { read: () => { throw new Error('unexpected read') } } })
    expect(await read(target, [{ server: 'bits', uri: 'a://1' }], 'remote:node-1:/work')).toEqual({ ok: true, value: [{ server: 'bits', uri: 'a://1', skipped: 'failed' }] })
    expect(await read(null, [{ server: 'bits', uri: 'a://1' }])).toEqual({ ok: true, value: [{ server: 'bits', uri: 'a://1', skipped: 'failed' }] })
    expect(await read(target, [{ server: 1 }])).toMatchObject({ ok: false, error: { code: 'invalid' } })
  })
})
