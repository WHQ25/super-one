import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, ContentBlock, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { createNodeSessionEventMapper } from '@superone/shared/node-session-event-map'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { mcpAppModelContextText, findMcpAppAttachment } from '@superone/shared/mcp-apps-state'
import type { McpAppAttachmentUpdate, ToolAppAttachment } from '@superone/shared/mcp-apps'
import { applyEventToSession, upsertCodexItem } from '@superone/chat-core'
import type { ChatCoreSession } from '@superone/chat-core'
import { buildSessionMessageCatalog } from '@superone/runtime/session/message-catalog'
import { stripEventForRemote } from '../remote-content'
import { projectProgressiveEvent } from './progressive-session'

const app: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://fixture/view', status: 'result', toolResult: { content: [], _meta: { secret: 'view-only' } } }
const use: ContentBlock = { type: 'tool_use', toolUseId: 'call', toolName: 'mcp__fixture__items', input: '{}', app }
const result: ContentBlock = { type: 'tool_result', toolUseId: 'call', summary: 'done', app }
const item: CodexMcpToolCallItem = { id: 'call', type: 'mcp_tool_call', server: 'fixture', tool: 'items', arguments: {}, status: 'completed', app }
const update: McpAppAttachmentUpdate = { resource: { html: '<html>saved</html>', hash: 'hash', meta: {} },
  modelContext: { structuredContent: { selected: 'b' }, source: { appInstanceId: 'view', server: 'fixture' } } }
const event: AgentEvent = { type: 'mcp_app_updated', messageId: 'm', appInstanceId: 'view', update }
const message = (content: ContentBlock[], codex = false): ChatMessage => ({ id: 'm', role: 'assistant', status: 'complete', createdAt: '', providerId: codex ? 'codex' : 'claude', content,
  ...(codex ? { metadata: { codex: { items: [item] } } } : {}) })
const envelope = (event: AgentEvent, sequence: number): EnvironmentEventEnvelope => ({ eventId: `e${sequence}`, environmentId: 'node', sequence: String(sequence), timestamp: sequence,
  aggregateType: 'session', aggregateId: 's', eventType: SESSION_DURABLE_EVENT.agentEvent, eventVersion: 1, payload: { event } })

describe('harness-neutral MCP App host state', () => {
  it.each(['claude', 'codex'] as const)('patches %s attachments in the reducer and survives JSON persistence', harness => {
    const session = { messages: [message(harness === 'claude' ? [use, result] : [], harness === 'codex')] } as ChatCoreSession
    const patch = applyEventToSession(session, event)
    const saved = JSON.parse(JSON.stringify(patch.messages)) as ChatMessage[]
    expect(findMcpAppAttachment(saved, 'view')?.app).toMatchObject(update)
    if (harness === 'claude') for (const block of saved[0]!.content) expect('app' in block && block.app).toMatchObject(update)
    expect(mcpAppModelContextText(saved)).toContain('selected')
    expect(mcpAppModelContextText(saved)).not.toContain('view-only')
  })

  it.each(['claude', 'codex'] as const)('reconstructs and patches remote %s catalog rows', harness => {
    const native: AgentEvent[] = harness === 'claude' ? [{ type: 'content_delta', messageId: 'm', delta: use }, { type: 'content_delta', messageId: 'm', delta: result }]
      : [{ type: 'codex_item_delta', messageId: 'm', phase: 'completed', item }]
    const rows = buildSessionMessageCatalog({ sessionId: 's', providerResume: 'thread', transcript: [{ id: 'm', role: 'assistant', text: 'done', createdAt: 1 }] },
      [...native, event].map((value, index) => envelope(value, index + 1)))
    expect(findMcpAppAttachment(JSON.parse(JSON.stringify(rows)), 'view')?.app).toMatchObject(update)
  })

  it('forwards the bounded patch through regular and progressive mobile stripping', () => {
    expect(stripEventForRemote(event)).toEqual(event)
    expect(projectProgressiveEvent(event, [message([use, result])])).toMatchObject(event)
  })

  it('maps a historical update without creating a new assistant message', () => {
    const mapper = createNodeSessionEventMapper({ sessionId: 's' })
    const mapped = mapper.map(envelope(event, 1))
    expect(mapped.map(value => value.type)).toEqual(['mcp_app_updated'])
  })

  it.each(['claude', 'codex'] as const)('resolves an in-flight %s View before its assistant transcript row is committed', harness => {
    const native: AgentEvent = harness === 'claude' ? { type: 'content_delta', messageId: 'm', delta: result }
      : { type: 'codex_item_delta', messageId: 'm', phase: 'completed', item }
    const rows = buildSessionMessageCatalog({ sessionId: 's', transcript: [], providerResume: 'thread' }, [envelope(native, 1), envelope(event, 2)])
    expect(findMcpAppAttachment(rows, 'view')).toMatchObject({ messageId: 'm', app: update })
  })

  it('preserves host state when later native result/item deltas arrive', () => {
    const enriched = { ...app, ...update }
    const content = applyContentDelta([{ ...use, app: enriched }], result)
    expect(findMcpAppAttachment([{ id: 'm', content }], 'view')?.app).toMatchObject(update)
    const items = upsertCodexItem([{ ...item, app: enriched }], item)
    expect(items[0]?.type === 'mcp_tool_call' && items[0].app).toMatchObject(update)
  })
})
