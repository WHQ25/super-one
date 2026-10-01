import { describe, expect, it, vi } from 'vitest'
import { createCodexMcpAppsProvider, attachCodexMcpApp } from '@superone/codex/mcp-apps'
import { mapCodexThreadItem } from '@superone/codex/agent-event-mapper'
import { mapThreadItemFromAppServer } from '../codex/codex-turn'
import { dispatchMcpAppsProviderRequest } from '@superone/runtime/mcp-apps/provider-rpc'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import type { McpAppsBinding } from '@superone/shared/mcp-apps'

const binding: McpAppsBinding = { node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }
const origin = { providerSessionId: 'thread-1' }
const signal = new AbortController().signal

describe('Codex native MCP Apps', () => {
  it('preserves UI, null appContext and private structured result in both mappers', () => {
    const raw = { id: 'item-1', type: 'mcpToolCall', server: 'fixture', tool: 'items', arguments: { page: 1 }, status: 'completed',
      mcpAppUi: { resourceUri: 'ui://fixture/items.html', preferredModelDisplayMode: 'inline' }, appContext: null,
      result: { content: [{ type: 'text', text: 'items' }], structuredContent: { page: 1 }, _meta: { private: 'view' }, isError: true } }
    for (const mapper of [mapCodexThreadItem, mapThreadItemFromAppServer]) {
      const mapped = mapper(raw)
      expect(mapped?.type).toBe('mcp_tool_call')
      if (mapped?.type !== 'mcp_tool_call') throw new Error('bad item')
      const item = attachCodexMcpApp(mapped, binding, 'thread-1')
      expect(item.appContext).toBeNull()
      expect(item.app).toMatchObject({ harnessCallId: 'item-1', origin, resourceUri: raw.mcpAppUi.resourceUri, toolResult: raw.result })
      expect(attachCodexMcpApp({ ...mapped, id: 'item-2' }, binding, 'thread-1').app?.appInstanceId).not.toBe(item.app?.appInstanceId)
    }
  })

  it('drops the null optional fields Codex emits, which the View result schema rejects', async () => {
    const raw = { id: 'item-1', type: 'mcpToolCall', server: 'fixture', tool: 'items', status: 'completed',
      mcpAppUi: { resourceUri: 'ui://fixture/items.html' }, result: { content: [{ type: 'text', text: 'items' }], structuredContent: null, _meta: null } }
    const mapped = mapCodexThreadItem(raw)
    if (mapped?.type !== 'mcp_tool_call') throw new Error('bad item')
    expect(attachCodexMcpApp(mapped, binding, 'thread-1').app?.toolResult).toEqual({ content: [{ type: 'text', text: 'items' }] })
    const request = vi.fn(async () => ({ content: [], structuredContent: null, _meta: null, isError: false }))
    expect((await createCodexMcpAppsProvider(binding, 'thread-1', request).callTool({ tool: 'next', args: {}, origin }, signal)).result).toEqual({ content: [], isError: false })
  })

  it('reads the legacy native URI when 0.159 emits null mcpAppUi', () => {
    expect(mapCodexThreadItem({ id: 'legacy', type: 'mcpToolCall', server: 'fixture', tool: 'items', mcpAppUi: null, mcpAppResourceUri: 'ui://fixture/items.html' })).toMatchObject({ mcpAppUi: { resourceUri: 'ui://fixture/items.html' } })
  })

  it('routes public read/call with threadId, omits hosted originCallId, and preserves completed isError', async () => {
    const request = vi.fn(async (method: string) => method.endsWith('/read') ? { contents: [{ uri: 'ui://fixture/items.html', text: '<html/>' }] } : { content: [], isError: true, structuredContent: { failed: true }, _meta: { private: 1 } })
    const provider = createCodexMcpAppsProvider(binding, 'thread-1', request)
    await provider.readResource({ uri: 'ui://fixture/items.html', origin: { ...origin, originCallId: 'ignored' } }, signal)
    expect(request).toHaveBeenCalledWith('mcpServer/resource/read', { server: 'fixture', threadId: 'thread-1', uri: 'ui://fixture/items.html' })
    expect(await provider.callTool({ tool: 'next', args: { page: 2 }, origin }, signal)).toEqual({ result: { content: [], isError: true, structuredContent: { failed: true }, _meta: { private: 1 } }, outcome: 'completed' })
  })

  it('refuses model-only calls before dispatch and rejects mismatched threads', async () => {
    const request = vi.fn(async () => ({ data: [{ name: 'fixture', tools: { secret: { name: 'secret', _meta: { ui: { visibility: ['model'] } } } } }] }))
    const provider = createCodexMcpAppsProvider(binding, 'thread-1', request)
    expect(await dispatchMcpAppsProviderRequest({ binding, origin, operation: 'callTool', tool: 'secret' }, provider)).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(request).toHaveBeenCalledTimes(1)
    const wrong = createCodexMcpAppsProvider(binding, 'thread-1', request)
    await expect(wrong.callTool({ tool: 'next', args: {}, origin: { providerSessionId: 'other' } }, signal)).rejects.toMatchObject({ code: 'invalid' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('distinguishes pre-dispatch cancellation, auth rejection and uncertain completion without retry', async () => {
    const request = vi.fn(async () => { throw new Error('connection closed') })
    const provider = createCodexMcpAppsProvider(binding, 'thread-1', request)
    await expect(provider.callTool({ tool: 'next', args: {} }, AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
    expect(request).not.toHaveBeenCalled()
    await expect(provider.callTool({ tool: 'next', args: {} }, signal)).rejects.toMatchObject({ code: 'unknown_outcome' })
    expect(request).toHaveBeenCalledTimes(1)
    const auth = createCodexMcpAppsProvider(binding, 'thread-1', async () => ({ content: [], _meta: { 'mcp/www_authenticate': ['Bearer realm="fixture"'] } }))
    await expect(auth.callTool({ tool: 'next', args: {} }, signal)).rejects.toMatchObject({ code: 'auth_required', challenge: ['Bearer realm="fixture"'] })
  })

  it('keeps storage identity stable across token rotation and changes it for server relocation', () => {
    expect(mcpServerConfigFingerprint({ url: 'https://a.test/mcp?token=a', http_headers: { Authorization: 'a' } })).toBe(mcpServerConfigFingerprint({ url: 'https://a.test/mcp?token=b', http_headers: { Authorization: 'b' } }))
    expect(mcpServerConfigFingerprint({ url: 'https://a.test/mcp' })).not.toBe(mcpServerConfigFingerprint({ url: 'https://b.test/mcp' }))
  })
})
