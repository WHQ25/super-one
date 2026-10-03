import { describe, expect, it } from 'vitest'
import type { ChatMessage, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { MCP_APP_RESULT_MAX_BYTES, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import { stripEventForRemote, stripMessagesForRemote } from './remote-content'

const app: ToolAppAttachment = {
  appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'x' },
  resourceUri: 'ui://cad/view', status: 'result', toolResult: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_RESULT_MAX_BYTES) }] },
}
const item: CodexMcpToolCallItem = { type: 'mcp_tool_call', id: 'item', server: 'cad', tool: 'pick', status: 'completed', arguments: {}, app }
const omitted = { toolResult: undefined, toolResultOmitted: { reason: 'size_limit' } }

describe('MCP App results sent to the phone', () => {
  it('bounds live attachments in streamed events', () => {
    const codex = stripEventForRemote({ type: 'codex_item_delta', messageId: 'm', phase: 'completed', item })
    expect((codex as { item: CodexMcpToolCallItem }).item.app).toMatchObject(omitted)
    const claude = stripEventForRemote({ type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'call', summary: 'ok', app } })
    expect((claude as { delta: { app: ToolAppAttachment } }).delta.app).toMatchObject(omitted)
  })

  it('bounds Codex items in snapshot messages, which are otherwise sent as is', () => {
    const message: ChatMessage = { id: 'm', role: 'assistant', status: 'complete', createdAt: 't', providerId: 'p', content: [],
      metadata: { codex: { items: [item] } } as ChatMessage['metadata'] }
    const [stripped] = stripMessagesForRemote([message])
    expect((stripped.metadata as { codex: { items: CodexMcpToolCallItem[] } }).codex.items[0].app).toMatchObject(omitted)
  })
})
