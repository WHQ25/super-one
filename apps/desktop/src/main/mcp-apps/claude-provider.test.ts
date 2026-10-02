import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { CLAUDE_MCP_CALL_VERIFIED_SDK, createClaudeMcpAppsProvider, toMcpToolDescriptor } from '@superone/claude/mcp-apps'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { MCP_APP_OUTPUT_MAX_BYTES } from '@superone/shared/mcp-apps'
import type { McpAppsBinding, McpToolDescriptor } from '@superone/shared/mcp-apps'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'my fixture', configGeneration: 0, configFingerprint: 'fp' }
const origin = { providerSessionId: 'claude-sid' }
const signal = new AbortController().signal

// Shapes observed from Claude Agent SDK 0.3.285 against the MCP Apps fixture server.
const NEXT_PAGE_RESPONSE = {
  subtype: 'success',
  request_id: 'r1',
  response: {
    content: '{"items":["item-4"],"page":2}',
    structuredContent: { items: ['item-4'], page: 2 },
    _meta: { 'fixture/private': { token: 'private-2' } },
  },
}
function controlRequestFailed(message: string): Error {
  return Object.assign(new Error(message), { telemetryMessage: 'Claude Code control request failed (mcp_call)', errorClass: 'control_request_failed' })
}

const TOOLS = new Map<string, McpToolDescriptor>([
  ['fixture_next_page', toMcpToolDescriptor({ name: 'fixture_next_page', _meta: { ui: { resourceUri: 'ui://fixture/items.html', visibility: ['app'] } } })],
  ['fixture_model_echo', toMcpToolDescriptor({ name: 'fixture_model_echo', _meta: { ui: { visibility: ['model'] } } })],
])

function provider(query: Partial<Record<'readMcpResource' | 'request', unknown>> | null) {
  return createClaudeMcpAppsProvider(binding, {
    assertBinding: () => {},
    query: async () => query as unknown as Query | null,
    providerSessionId: () => 'claude-sid',
    tools: async () => TOOLS,
    serverStatus: async () => 'connected',
  })
}

describe('Claude native MCP Apps provider', () => {
  it('refuses request metadata it cannot forward rather than dropping it', async () => {
    const request = vi.fn()
    await expect(provider({ request }).callTool({ tool: 'fixture_next_page', args: {}, meta: { 'openai/resource': { path: '/w/part.stl' } } }, signal)).rejects.toMatchObject({ code: 'denied' })
    expect(request).not.toHaveBeenCalled()
  })

  it('retains the Claude JSON text duplicate within the transient output budget', async () => {
    const structuredContent = { data: 'x'.repeat(1024 * 1024) }
    const request = vi.fn(async () => ({ response: { content: JSON.stringify(structuredContent), structuredContent } }))
    const p = provider({ request })
    const response = await p.callTool({ tool: 'fixture_next_page', args: {} }, signal)
    expect(response.result.structuredContent).toEqual(structuredContent)
    expect(response.result.content).toEqual([{ type: 'text', text: JSON.stringify(structuredContent) }])
    request.mockResolvedValue({ response: { content: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES), structuredContent } })
    await expect(p.callTool({ tool: 'fixture_next_page', args: {} }, signal)).rejects.toMatchObject({ code: 'invalid' })
    await expect(p.callTool({ tool: 'fixture_next_page', args: { x: 'x'.repeat(1024 * 1024) } }, signal)).rejects.toMatchObject({ code: 'invalid' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('allows 2 MiB HTML envelopes and separates transient reads from snapshot reads', async () => {
    const readMcpResource = vi.fn(async () => ({ contents: [{ uri: 'ui://fixture/items.html', text: 'x'.repeat(2 * 1024 * 1024) }] }))
    const p = provider({ readMcpResource })
    await expect(p.readResource({ uri: 'ui://fixture/items.html' }, signal)).resolves.toHaveProperty('contents')
    readMcpResource.mockResolvedValue({ contents: [{ uri: 'ui://fixture/items.html', text: 'x'.repeat(4 * 1024 * 1024) }] })
    await expect(p.readResource({ uri: 'ui://fixture/items.html' }, signal)).rejects.toMatchObject({ code: 'invalid' })
    await expect(p.readResource({ uri: 'ui://fixture/items.html', transient: true }, signal)).resolves.toHaveProperty('contents')
    readMcpResource.mockResolvedValue({ contents: [{ uri: 'ui://fixture/items.html', text: 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES) }] })
    await expect(p.readResource({ uri: 'ui://fixture/items.html', transient: true }, signal)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('reports tool calls unsupported when the runtime has no control request', async () => {
    expect(await provider({ readMcpResource: vi.fn() }).ready(signal)).toEqual({ mode: 'native', resourceRead: true, toolCall: false, authenticate: false })
    expect(await provider({ readMcpResource: vi.fn(), request: vi.fn() }).ready(signal)).toMatchObject({ toolCall: true })
  })

  it('reads View documents only from ui:// and refuses other schemes before dispatch', async () => {
    const readMcpResource = vi.fn(async () => ({ contents: [{ uri: 'ui://fixture/items.html', text: '<html/>', _meta: { ui: { prefersBorder: true } } }] }))
    const p = provider({ readMcpResource })
    expect(await p.readResource({ uri: 'ui://fixture/items.html', origin }, signal)).toEqual({ contents: [{ uri: 'ui://fixture/items.html', text: '<html/>', _meta: { ui: { prefersBorder: true } } }] })
    expect(readMcpResource).toHaveBeenCalledWith('my fixture', 'ui://fixture/items.html')
    await expect(p.readResource({ uri: 'file:///etc/hosts' }, signal)).rejects.toMatchObject({ code: 'invalid' })
    expect(readMcpResource).toHaveBeenCalledTimes(1)
    // A View's own reads may use the server's other schemes; the server decides what they mean.
    await p.readResource({ uri: 'cad-resource://fixture/import.wasm', transient: true }, signal)
    expect(readMcpResource).toHaveBeenLastCalledWith('my fixture', 'cad-resource://fixture/import.wasm')
  })

  it('calls the qualified tool and normalizes the post-processed result', async () => {
    const request = vi.fn(async () => NEXT_PAGE_RESPONSE)
    const result = await provider({ request }).callTool({ tool: 'fixture_next_page', args: { page: 2 }, origin }, signal)
    expect(request).toHaveBeenCalledWith({ subtype: 'mcp_call', tool: 'mcp__my_fixture__fixture_next_page', arguments: { page: 2 } }, { signal })
    expect(result).toEqual({
      result: {
        content: [{ type: 'text', text: NEXT_PAGE_RESPONSE.response.content }],
        structuredContent: NEXT_PAGE_RESPONSE.response.structuredContent,
        _meta: NEXT_PAGE_RESPONSE.response._meta,
      },
      outcome: 'completed',
    })
  })

  it('normalizes the tool name the way Claude qualifies it', async () => {
    const request = vi.fn(async () => NEXT_PAGE_RESPONSE)
    await provider({ request }).callTool({ tool: 'cad.library', args: {}, origin }, signal)
    expect(request).toHaveBeenCalledWith({ subtype: 'mcp_call', tool: 'mcp__my_fixture__cad_library', arguments: {} }, { signal })
  })

  it('reports a rejected mcp_call as a failed result with an uncertain outcome', async () => {
    const request = vi.fn(async () => { throw controlRequestFailed('fixture failure') })
    expect(await provider({ request }).callTool({ tool: 'fixture_next_page', args: {} }, signal)).toEqual({
      result: { content: [{ type: 'text', text: 'fixture failure' }], isError: true },
      outcome: 'unknown_outcome',
    })
  })

  it('distinguishes cancellation before and after dispatch', async () => {
    const request = vi.fn()
    await expect(provider({ request }).callTool({ tool: 'fixture_next_page', args: {} }, AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
    expect(request).not.toHaveBeenCalled()

    const controller = new AbortController()
    const inFlight = vi.fn(async () => { controller.abort(); throw new Error('host cancel') })
    await expect(provider({ request: inFlight }).callTool({ tool: 'fixture_next_page', args: {} }, controller.signal)).rejects.toMatchObject({ code: 'unknown_outcome' })
  })

  it('rejects a View bound to another Claude session and a stopped runtime', async () => {
    const request = vi.fn()
    await expect(provider({ request }).callTool({ tool: 'fixture_next_page', args: {}, origin: { providerSessionId: 'other' } }, signal)).rejects.toMatchObject({ code: 'invalid' })
    await expect(provider(null).callTool({ tool: 'fixture_next_page', args: {} }, signal)).rejects.toMatchObject({ code: 'not_connected' })
    expect(request).not.toHaveBeenCalled()
  })

  it('never reaches mcp_call for a model-only tool, because mcp_call itself checks nothing', async () => {
    const request = vi.fn(async () => NEXT_PAGE_RESPONSE)
    const p = provider({ request })
    expect(await dispatchMcpAppsProviderRequest({ binding, origin, operation: 'callTool', tool: 'fixture_model_echo' }, p)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('is pinned to the SDK version whose mcp_call was verified live', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../../packages/claude/package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
    const version = manifest.dependencies['@anthropic-ai/claude-agent-sdk']
    // On failure: rerun `bun apps/desktop/scripts/check-claude-mcp-apps.ts`, then update the constant.
    expect(version).toBe(CLAUDE_MCP_CALL_VERIFIED_SDK)
  })
})
