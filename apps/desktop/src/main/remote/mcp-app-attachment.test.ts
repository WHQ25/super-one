import { describe, expect, it } from 'vitest'
import { applyContentDelta } from '@superone/shared/content-delta'
import { assertMcpAppSize, McpAppsError, mcpAppResourceUri, mcpAppToolVisible, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { AgentEvent, ChatMessage, ContentBlock, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { stripEventForRemote, stripMessagesForRemote } from '../remote-content'
import { projectProgressiveMessage } from '@superone/runtime/stream'

const app: ToolAppAttachment = {
  appInstanceId: 'view-1', binding: { node: 'n', session: 's', server: 'fixture', configGeneration: 1, configFingerprint: 'stable' },
  origin: { providerSessionId: 'thread-1' }, harnessCallId: 'call-1', resourceUri: 'ui://fixture/items.html',
  resource: { html: '<html>snapshot</html>', hash: 'abc', meta: { csp: { connectDomains: [] } } },
  toolInput: { query: 'x'.repeat(1500) }, toolResult: { content: [{ type: 'text', text: 'ok' }], structuredContent: { page: 1 }, _meta: { secret: 'view-only' }, isError: false },
  modelContext: { structuredContent: { selected: 'a' }, source: { appInstanceId: 'view-1', server: 'fixture' } }, status: 'result',
}
const use: ContentBlock = { type: 'tool_use', toolUseId: 'call-1', toolName: 'mcp__fixture__items', input: JSON.stringify(app.toolInput), app }
const result: ContentBlock = { type: 'tool_result', toolUseId: 'call-1', summary: 'x'.repeat(500), app }

describe('MCP App attachment across transcript and mobile projection', () => {
  it('keeps the snapshot, private result and context across delta reduction, JSON persistence and mobile stripping', () => {
    const content = applyContentDelta(applyContentDelta([], use), result)
    const message: ChatMessage = JSON.parse(JSON.stringify({ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: 'claude', content }))
    const projected = stripMessagesForRemote([projectProgressiveMessage(message)])[0]!
    expect(projected.content).toEqual(message.content)
    const event: AgentEvent = { type: 'content_delta', messageId: 'm', delta: result }
    expect(stripEventForRemote(event)).toEqual(event)
  })

  it('keeps native Codex attachments when progressive item detail is deferred', () => {
    const item: CodexMcpToolCallItem = { id: 'call-1', type: 'mcp_tool_call', server: 'fixture', tool: 'items', arguments: app.toolInput, status: 'completed', app }
    const message: ChatMessage = { id: 'm', role: 'assistant', status: 'complete', createdAt: '', content: [], metadata: { codex: { items: [item] } } }
    expect(projectProgressiveMessage(message).metadata?.codex?.items[0]).toEqual(item)
  })

  it('uses standard UI metadata first and defaults visibility to app + model', () => {
    expect(mcpAppResourceUri({ name: 'x', inputSchema: {}, _meta: { ui: { resourceUri: 'ui://a' }, 'ui/resourceUri': 'ui://b' } })).toBe('ui://a')
    expect(mcpAppResourceUri({ name: 'x', inputSchema: {}, _meta: { 'ui/resourceUri': 'ui://b' } })).toBe('ui://b')
    expect(mcpAppToolVisible({ name: 'x' })).toBe(true)
    expect(mcpAppToolVisible({ name: 'x', inputSchema: {}, _meta: { ui: { visibility: ['model'] } } })).toBe(false)
  })

  it('rejects oversized UTF-8 data and serializes structured errors', () => {
    expect(() => assertMcpAppSize({ text: '界'.repeat(10) }, 20)).toThrow(McpAppsError)
    expect(JSON.parse(JSON.stringify(new McpAppsError('auth_required', 'login', ['Bearer'])))).toEqual({ code: 'auth_required', message: 'login', challenge: ['Bearer'] })
  })
})
