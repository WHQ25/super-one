import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachCodexMcpApp, createCodexMcpAppsProvider, prewarmCodexMcpAppCatalog, type McpAppsRequest } from './mcp-apps'
import type { CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { invalidateCodexMcpAppsCatalog } from './mcp-apps-catalog'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { MCP_APP_OUTPUT_MAX_BYTES, MCP_APP_RESULT_MAX_BYTES } from '@superone/shared/mcp-apps'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }
const catalog = { data: [{ name: 'fixture', tools: { next: { name: 'next', inputSchema: { type: 'object' }, _meta: { ui: { visibility: ['app'] } } } } }] }
const listCount = (request: ReturnType<typeof vi.fn<McpAppsRequest>>) => request.mock.calls.filter(([method]) => method === 'mcpServerStatus/list').length
afterEach(() => vi.useRealTimers())

it('omits an oversized App snapshot without changing the native model tool result', () => {
  const result = { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_RESULT_MAX_BYTES) }], structuredContent: null, meta: { private: 'View data' } }
  const item: CodexMcpToolCallItem = { type: 'mcp_tool_call', id: 'native', server: 'fixture', tool: 'next', status: 'completed', arguments: {}, result, mcpAppUi: { resourceUri: 'ui://fixture/view' } }
  const original = JSON.stringify(item)
  const attached = attachCodexMcpApp(item, binding, 'thread')
  expect(attached.result).toBe(result)
  expect(JSON.stringify(item)).toBe(original)
  expect(attached.app).toMatchObject({ status: 'result', toolResultOmitted: { reason: 'size_limit' } })
  expect(attached.app?.toolResult).toBeUndefined()
})

it('marks Codex\'s truncated preview of an oversized result as omitted instead of passing it to the View', () => {
  const preview = '{"content":[],"structuredContent":{"part":{"id":"hex"' + 'x'.repeat(100) + '…75350 chars truncated…' + '"localFilesystem":true}}'
  const result = { content: [{ type: 'text', text: preview }], structuredContent: null }
  const item: CodexMcpToolCallItem = { type: 'mcp_tool_call', id: 'native', server: 'fixture', tool: 'next', status: 'completed', arguments: {}, result, mcpAppUi: { resourceUri: 'ui://fixture/view' } }
  const app = attachCodexMcpApp(item, binding, 'thread').app
  expect(app).toMatchObject({ status: 'result', toolResultOmitted: { bytes: new TextEncoder().encode(preview).byteLength + 75350, reason: 'size_limit' } })
  expect(app?.toolResult).toBeUndefined()
  // A text result that merely mentions truncation is still the server's own result.
  const own = { content: [{ type: 'text', text: 'Log …3 chars truncated…' }], structuredContent: null }
  expect(attachCodexMcpApp({ ...item, result: own }, binding, 'thread').app?.toolResult?.content).toEqual(own.content)
})

describe('Codex MCP App catalog cache', () => {
  it('prewarms only attached Apps and shares discovery with real visibility admission', async () => {
    let complete!: (value: Record<string, unknown>) => void
    const request = vi.fn<McpAppsRequest>(method => method === 'mcpServerStatus/list'
      ? new Promise(resolve => { complete = resolve }) : Promise.resolve({ content: [] }))
    const key = {}, item: CodexMcpToolCallItem = { type: 'mcp_tool_call', id: 'native', server: 'fixture', tool: 'next', status: 'completed', arguments: {} }
    prewarmCodexMcpAppCatalog(item, request, key)
    expect(request).not.toHaveBeenCalled()
    const attached = attachCodexMcpApp({ ...item, mcpAppUi: { resourceUri: 'ui://fixture/view' } }, binding, 'thread')
    prewarmCodexMcpAppCatalog(attached, request, key)
    prewarmCodexMcpAppCatalog(attached, request, key)
    expect(listCount(request)).toBe(1)
    const call = dispatchMcpAppsProviderRequest({ operation: 'callTool', binding, origin: { providerSessionId: 'thread' }, tool: 'next', args: {} }, createCodexMcpAppsProvider(binding, 'thread', request, key))
    expect(request.mock.calls.some(([method]) => method === 'mcpServer/tool/call')).toBe(false)
    complete(catalog)
    expect(await call).toMatchObject({ ok: true })
    expect(listCount(request)).toBe(1)
  })
  it('allows real discovery to retry a failed background prewarm', async () => {
    const request = vi.fn<McpAppsRequest>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(catalog), key = {}
    const item = attachCodexMcpApp({ type: 'mcp_tool_call', id: 'native', server: 'fixture', tool: 'next', status: 'completed', arguments: {}, mcpAppUi: { resourceUri: 'ui://fixture/view' } }, binding, 'thread')
    prewarmCodexMcpAppCatalog(item, request, key)
    await vi.waitFor(async () => expect((await createCodexMcpAppsProvider(binding, 'thread', request, key).tools()).has('next')).toBe(true))
    expect(listCount(request)).toBe(2)
  })
  it('keeps lightweight discovery off repeated View calls even after a long idle', async () => {
    vi.useFakeTimers()
    const key = {}, request = vi.fn<McpAppsRequest>(async method => method === 'mcpServerStatus/list' ? catalog : { content: [] })
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    await provider().ready(new AbortController().signal)
    expect(listCount(request)).toBe(0)
    for (let i = 0; i < 3; i++) {
      expect(await dispatchMcpAppsProviderRequest({ operation: 'callTool', binding, origin: { providerSessionId: 'thread' }, tool: 'next', args: {} }, provider())).toMatchObject({ ok: true })
    }
    expect(listCount(request)).toBe(1)
    expect(request.mock.calls[0]).toEqual(['mcpServerStatus/list', { detail: 'toolsAndAuthOnly', threadId: 'thread', server: 'fixture' }])
    vi.advanceTimersByTime(60 * 60 * 1000)
    await provider().tools()
    expect(listCount(request)).toBe(1)
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
  it('refreshes a notLoggedIn snapshot while waiting for OAuth completion', async () => {
    const key = {}, request = vi.fn<McpAppsRequest>()
      .mockResolvedValueOnce({ data: [{ name: 'fixture', authStatus: 'notLoggedIn' }] })
      .mockResolvedValue(catalog)
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    await expect(provider().tools()).rejects.toMatchObject({ code: 'auth_required' })
    expect((await provider().tools()).has('next')).toBe(true)
    expect(listCount(request)).toBe(2)
  })
  it('does not republish a pending catalog invalidated by reconnect', async () => {
    let complete!: (value: Record<string, unknown>) => void
    const key = {}, request = vi.fn<McpAppsRequest>()
      .mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
      .mockResolvedValue({ data: [{ name: 'fixture', tools: {} }] })
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    const stale = provider().tools()
    invalidateCodexMcpAppsCatalog(key)
    expect((await provider().tools()).size).toBe(0)
    complete(catalog)
    await stale
    expect((await provider().tools()).size).toBe(0)
    expect(listCount(request)).toBe(2)
  })
  it('discovers a newly added app tool on a miss, once across concurrent calls', async () => {
    let added = false
    const key = {}, request = vi.fn<McpAppsRequest>(async method => method === 'mcpServerStatus/list'
      ? { data: [{ name: 'fixture', tools: added ? { added: { name: 'added' } } : {} }] }
      : { content: [] })
    const provider = () => createCodexMcpAppsProvider(binding, 'thread', request, key)
    await provider().tools()
    added = true
    const input = { operation: 'callTool' as const, binding, origin: { providerSessionId: 'thread' }, tool: 'added', args: {} }
    expect(await Promise.all([dispatchMcpAppsProviderRequest(input, provider()), dispatchMcpAppsProviderRequest(input, provider())])).toEqual([
      { ok: true, value: { result: { content: [] }, outcome: 'completed' } },
      { ok: true, value: { result: { content: [] }, outcome: 'completed' } },
    ])
    expect(listCount(request)).toBe(2)
  })
  it('limits sequential unknown-tool refreshes to one per session every ten seconds', async () => {
    vi.useFakeTimers()
    const key = {}, request = vi.fn<McpAppsRequest>(async () => catalog)
    const miss = (tool: string) => dispatchMcpAppsProviderRequest({ operation: 'callTool', binding, origin: { providerSessionId: 'thread' }, tool, args: {} }, createCodexMcpAppsProvider(binding, 'thread', request, key))
    for (const name of ['unknown1', 'unknown2', 'unknown3']) expect(await miss(name)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(listCount(request)).toBe(2) // initial discovery plus one miss refresh
    vi.advanceTimersByTime(9_999)
    await miss('unknown4')
    expect(listCount(request)).toBe(2)
    vi.advanceTimersByTime(1)
    await miss('unknown5')
    expect(listCount(request)).toBe(3)
    expect(request.mock.calls.some(([method]) => method === 'mcpServer/tool/call')).toBe(false)
  })
  it('does not refresh or dispatch a model-only tool found in the cached catalog', async () => {
    const request = vi.fn<McpAppsRequest>(async () => ({ data: [{ name: 'fixture', tools: { secret: { name: 'secret', _meta: { ui: { visibility: ['model'] } } } } }] }))
    const input = { operation: 'callTool' as const, binding, origin: { providerSessionId: 'thread' }, tool: 'secret', args: {} }
    expect(await dispatchMcpAppsProviderRequest(input, createCodexMcpAppsProvider(binding, 'thread', request))).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

it('uses read-content UI metadata without discovering unrelated server resources', async () => {
  const meta = { ui: { csp: { connectDomains: ['https://read.example'] } }, 'openai/ui': { preferredDisplayMode: 'inline' } }
  const request = vi.fn<McpAppsRequest>(async () => ({ contents: [{ uri: 'ui://fixture/view', text: '<html/>', _meta: meta }] }))
  const provider = createCodexMcpAppsProvider(binding, 'thread', request)
  expect((await provider.readResource({ uri: 'ui://fixture/view' }, new AbortController().signal)).contents[0]._meta).toEqual(meta)
  expect(request.mock.calls.map(([method]) => method)).toEqual(['mcpServer/resource/read'])
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

it('bounds transient tool and read output at the View output cap while keeping requests and snapshots smaller', async () => {
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
