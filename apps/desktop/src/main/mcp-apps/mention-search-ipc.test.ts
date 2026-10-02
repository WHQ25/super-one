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

function session(servers: Record<string, { tools?: McpToolDescriptor[] | Error; call?: (args: unknown) => unknown }>) {
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
