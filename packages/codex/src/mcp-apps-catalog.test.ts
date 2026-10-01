import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexMcpAppsProvider, type McpAppsRequest } from './mcp-apps'
import { invalidateCodexMcpAppsCatalog, CODEX_MCP_APPS_CATALOG_TTL_MS } from './mcp-apps-catalog'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { MCP_APP_OUTPUT_MAX_BYTES } from '@superone/shared/mcp-apps'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }
const catalog = { data: [{ name: 'fixture', tools: { next: { name: 'next', inputSchema: { type: 'object' }, _meta: { ui: { visibility: ['app'] } } } } }] }
const listCount = (request: ReturnType<typeof vi.fn<McpAppsRequest>>) => request.mock.calls.filter(([method]) => method === 'mcpServerStatus/list').length
afterEach(() => vi.useRealTimers())

describe('Codex MCP App catalog cache', () => {
  it('ready performs no discovery; callTool reuses one list across facade recreation within TTL', async () => {
    vi.useFakeTimers()
    const key = {}, request = vi.fn<McpAppsRequest>(async method => method === 'mcpServerStatus/list' ? catalog : { content: [] })
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    await provider().ready(new AbortController().signal)
    expect(listCount(request)).toBe(0)
    for (let i = 0; i < 3; i++) {
      expect(await dispatchMcpAppsProviderRequest({ operation: 'callTool', binding, origin: { providerSessionId: 'thread' }, tool: 'next', args: {} }, provider())).toMatchObject({ ok: true })
    }
    expect(listCount(request)).toBe(1)
    vi.advanceTimersByTime(CODEX_MCP_APPS_CATALOG_TTL_MS + 1)
    await provider().tools()
    expect(listCount(request)).toBe(2)
  })
  it('shares concurrent discovery and isolates configuration and connection generations', async () => {
    const key = {}, request = vi.fn<McpAppsRequest>(async () => catalog)
    const provider = (b = binding, k = key) => createCodexMcpAppsProvider(b, 'thread', request, k)
    await Promise.all([provider().tools(), provider().tools()])
    expect(listCount(request)).toBe(1)
    invalidateCodexMcpAppsCatalog(key)
    await provider().tools()
    await provider({ ...binding, configFingerprint: 'changed' }).tools()
    await provider(binding, {}).tools()
    expect(listCount(request)).toBe(4)
  })
  it('does not cache a discovery failure or stale auth result after reconnect', async () => {
    const key = {}, request = vi.fn<McpAppsRequest>().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue(catalog)
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    await expect(provider().tools()).rejects.toThrow('disconnected')
    await provider().tools()
    await provider().authenticate!({}, new AbortController().signal)
    await provider().tools()
    expect(listCount(request)).toBe(3)
  })
})

it('carries tool titles and server icons through native status discovery', async () => {
  const request = vi.fn<McpAppsRequest>(async () => ({ data: [{ name: 'fixture', serverInfo: { name: 'fixture', version: '1', title: 'Fixture CAD', icons: [{ src: 'https://example.com/cad.png' }] }, tools: { next: { name: 'next', title: 'Browse', icons: [{ src: 'https://example.com/tool.png' }] } } }] }))
  const tool = (await createCodexMcpAppsProvider(binding, 'thread', request).tools()).get('next')
  expect(tool).toMatchObject({ title: 'Browse', icons: [{ src: 'https://example.com/tool.png' }], serverInfo: { title: 'Fixture CAD', icons: [{ src: 'https://example.com/cad.png' }] } })
})

it('normalizes null server titles and icons to absent presentation fields', async () => {
  const request = vi.fn<McpAppsRequest>(async () => ({ data: [{ name: 'fixture', serverInfo: { name: 'fixture', title: null, version: '1', icons: null }, tools: { next: { name: 'next', title: null, icons: null } } }] }))
  expect((await createCodexMcpAppsProvider(binding, 'thread', request).tools()).get('next')?.serverInfo).toEqual({})
})

it('bounds transient tool and read output at 8 MiB while keeping requests and snapshots smaller', async () => {
  let bytes = 2 * 1024 * 1024
  const request = vi.fn<McpAppsRequest>(async method => method === 'mcpServerStatus/list' ? catalog : method === 'mcpServer/resource/read' ? { contents: [{ uri: 'ui://large', text: 'x'.repeat(bytes) }] } : { content: [{ type: 'text', text: 'x'.repeat(bytes) }] })
  const p = createCodexMcpAppsProvider(binding, 'thread', request)
  await expect(p.callTool({ tool: 'next', args: {} }, new AbortController().signal)).resolves.toHaveProperty('result')
  await expect(p.readResource({ uri: 'ui://large' }, new AbortController().signal)).resolves.toHaveProperty('contents')
  bytes = 4 * 1024 * 1024
  await expect(p.readResource({ uri: 'ui://large' }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' })
  await expect(p.readResource({ uri: 'ui://large', transient: true }, new AbortController().signal)).resolves.toHaveProperty('contents')
  bytes = MCP_APP_OUTPUT_MAX_BYTES
  await expect(p.callTool({ tool: 'next', args: {} }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' })
  await expect(p.readResource({ uri: 'ui://large', transient: true }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' })
  const count = request.mock.calls.length
  await expect(p.callTool({ tool: 'next', args: { x: 'x'.repeat(1024 * 1024) } }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid' })
  expect(request.mock.calls).toHaveLength(count)
})
