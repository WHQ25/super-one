import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexMcpToolCallItem } from './agent-types'
import { MCP_APP_RESULT_MAX_BYTES, type ToolAppAttachment } from './mcp-apps'
import { persistedMcpAppEvent, persistedMcpAppMessage, updateMcpAppAttachments } from './mcp-apps-state'

const binding = { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'x' }
const app = (id: string, text: string): ToolAppAttachment => ({
  appInstanceId: id, binding, resourceUri: 'ui://cad/view', status: 'result', toolInput: {},
  toolResult: { content: [{ type: 'text', text }] }, resource: { hash: 'a'.repeat(64), meta: {} },
})
const large = 'x'.repeat(MCP_APP_RESULT_MAX_BYTES)
const item = (attachment: ToolAppAttachment): CodexMcpToolCallItem => ({
  type: 'mcp_tool_call', id: attachment.appInstanceId, server: 'cad', tool: 'pick', status: 'completed', arguments: {}, app: attachment,
})
const message = (content: ToolAppAttachment, codex: ToolAppAttachment): ChatMessage => ({
  id: 'm', role: 'assistant', status: 'complete', createdAt: 't', providerId: 'p',
  content: [{ type: 'text', text: 'Done' }, { type: 'tool_result', toolUseId: 'call', summary: 'ok', app: content }],
  metadata: { codex: { items: [item(codex)], threadId: 'thread' } } as ChatMessage['metadata'],
})
const omitted = { toolResult: undefined, toolResultOmitted: { reason: 'size_limit' } }

describe('persistedMcpAppMessage', () => {
  it('bounds content and Codex item results above the transcript cap and keeps host state', () => {
    const source = message(app('claude', large), app('codex', large))
    const persisted = persistedMcpAppMessage(source)
    expect(persisted.content[1]).toMatchObject({ app: { ...omitted, resource: { hash: 'a'.repeat(64) } } })
    expect((persisted.metadata as { codex: { items: CodexMcpToolCallItem[]; threadId: string } }).codex).toMatchObject({ threadId: 'thread', items: [{ app: omitted }] })
    expect(persisted.content[0]).toBe(source.content[0])
    expect((source.content[1] as { app: ToolAppAttachment }).app.toolResult).toBeDefined()
  })

  it('returns the same message when every result fits', () => {
    const source = message(app('claude', 'small'), app('codex', 'small'))
    expect(persistedMcpAppMessage(source)).toBe(source)
  })

  it('bounds each live attachment once', () => {
    const source = message(app('claude', large), app('codex', 'small'))
    const appOf = (value: ChatMessage) => (value.content[1] as { app: ToolAppAttachment }).app
    expect(appOf(persistedMcpAppMessage(source))).toBe(appOf(persistedMcpAppMessage(source)))
  })
})

describe('persistedMcpAppEvent', () => {
  const big = app('v', large)
  it.each<[string, AgentEvent, (event: AgentEvent) => ToolAppAttachment | undefined]>([
    ['content_delta', { type: 'content_delta', messageId: 'm', delta: { type: 'tool_result', toolUseId: 'call', summary: 'ok', app: big } },
      event => (event as { delta: { app?: ToolAppAttachment } }).delta.app],
    ['codex_item_delta', { type: 'codex_item_delta', messageId: 'm', phase: 'completed', item: item(big) },
      event => (event as { item: CodexMcpToolCallItem }).item.app],
    ['message_start', { type: 'message_start', message: message(big, app('codex', 'small')) },
      event => ((event as { message: ChatMessage }).message.content[1] as { app: ToolAppAttachment }).app],
    ['message_complete', { type: 'message_complete', messageId: 'm', metadata: { codex: { items: [item(big)] } } as never },
      event => ((event as { metadata: { codex: { items: CodexMcpToolCallItem[] } } }).metadata.codex.items[0]).app],
  ])('bounds %s', (_type, event, pick) => {
    expect(pick(persistedMcpAppEvent(event))).toMatchObject(omitted)
    expect(pick(event)?.toolResult).toBeDefined()
  })

  it('passes other events through unchanged', () => {
    const event: AgentEvent = { type: 'message_complete', messageId: 'm' }
    expect(persistedMcpAppEvent(event)).toBe(event)
  })
})

describe('updateMcpAppAttachments', () => {
  it('patches only the matching attachment in content and Codex items', () => {
    const source = message(app('claude', 'small'), app('codex', 'small'))
    const modelContext = { content: [{ type: 'text' as const, text: 'Picked' }], source: { appInstanceId: 'codex', server: 'cad' } }
    const [updated] = updateMcpAppAttachments([source], 'codex', { modelContext })
    expect(updated.content).toBe(source.content)
    expect((updated.metadata as { codex: { items: CodexMcpToolCallItem[] } }).codex.items[0].app?.modelContext).toEqual(modelContext)
    expect(updateMcpAppAttachments([source], 'missing', { modelContext: null })[0]).toBe(source)
  })
})
