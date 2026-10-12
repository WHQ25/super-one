import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope, type SessionMessageBlock } from '@superone/shared/environment'
import { mcpAppEventAttachment, updateMcpAppAttachments } from '@superone/shared/mcp-apps-state'

/** Add rows for live app calls not yet committed, then replay harness-neutral host updates. */
export function applyMcpAppsCatalogEvents(messages: SessionMessageBlock[], events: EnvironmentEventEnvelope[], sessionId: string, contentById: Map<string, ContentBlock[]>): SessionMessageBlock[] {
  const liveAppRows = new Map<string, number>()
  const updates: Extract<AgentEvent, { type: 'mcp_app_updated' }>[] = []
  for (const envelope of events) {
    if (envelope.aggregateType && envelope.aggregateType !== 'session') continue
    if (envelope.aggregateId && envelope.aggregateId !== sessionId) continue
    if (envelope.eventType !== SESSION_DURABLE_EVENT.agentEvent) continue
    const event = (envelope.payload as { event?: AgentEvent })?.event
    if (event && mcpAppEventAttachment(event) && 'messageId' in event && typeof event.messageId === 'string') liveAppRows.set(event.messageId, envelope.timestamp)
    if (event?.type === 'mcp_app_updated') updates.push(event)
  }
  // A View can issue requests before the model turn ends and commits its transcript row.
  const ids = new Set(messages.map(message => message.id))
  for (const [id, createdAt] of liveAppRows) if (!ids.has(id)) messages.push({ id, role: 'assistant', text: '', createdAt,
    sortOrder: messages.length, ...(contentById.has(id) ? { content: contentById.get(id) } : {}) })
  let next = messages
  for (const event of updates) next = updateMcpAppAttachments(next, event.appInstanceId, event.update)
  return next
}
