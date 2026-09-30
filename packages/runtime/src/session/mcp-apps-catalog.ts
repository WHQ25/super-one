import type { AgentEvent, CodexThreadItem, ContentBlock } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope, type SessionMessageBlock } from '@superone/shared/environment'
import { mcpAppEventAttachment, mergeMcpAppAttachment, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'

/** Preserve native item attachments and then replay harness-neutral host updates. */
export function applyMcpAppsCatalogEvents(messages: SessionMessageBlock[], events: EnvironmentEventEnvelope[], sessionId: string, contentById: Map<string, ContentBlock[]>): SessionMessageBlock[] {
  const itemsByMessage = new Map<string, Map<string, CodexThreadItem>>()
  const liveAppRows = new Map<string, number>()
  const updates: Extract<AgentEvent, { type: 'mcp_app_updated' }>[] = []
  for (const envelope of events) {
    if (envelope.aggregateType && envelope.aggregateType !== 'session') continue
    if (envelope.aggregateId && envelope.aggregateId !== sessionId) continue
    if (envelope.eventType !== SESSION_DURABLE_EVENT.agentEvent) continue
    const event = (envelope.payload as { event?: AgentEvent })?.event
    if (event && mcpAppEventAttachment(event) && 'messageId' in event) liveAppRows.set(event.messageId, envelope.timestamp)
    if (event?.type === 'mcp_app_updated') updates.push(event)
    if (event?.type !== 'codex_item_delta') continue
    const items = itemsByMessage.get(event.messageId) ?? new Map<string, CodexThreadItem>()
    const previous = items.get(event.item.id)
    items.set(event.item.id, event.item.type === 'mcp_tool_call' && previous?.type === 'mcp_tool_call'
      ? { ...event.item, app: mergeMcpAppAttachment(previous.app, event.item.app) } : event.item)
    itemsByMessage.set(event.messageId, items)
  }
  // A View can issue requests before the model turn ends and commits its transcript row.
  const ids = new Set(messages.map(message => message.id))
  for (const [id, createdAt] of liveAppRows) if (!ids.has(id)) messages.push({ id, role: 'assistant', text: '', createdAt,
    sortOrder: messages.length, ...(contentById.has(id) ? { content: contentById.get(id) } : {}) })
  let next = messages.map(message => {
    const items = itemsByMessage.get(message.id)
    if (!items) return message
    const codex = message.metadata?.codex as Record<string, unknown> | undefined
    return { ...message, metadata: { ...message.metadata, codex: { ...codex, items: [...items.values()] } } }
  })
  for (const event of updates) next = updateMcpAppAttachments(next, event.appInstanceId, event.update)
  return next
}
