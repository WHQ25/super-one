import type { AgentEvent } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'
import { mcpAppEventAttachment } from '@superone/shared/mcp-apps-state'

/** Live start/completion pairing, with bounded retention for interrupted streams. */
export class RemoteMcpAppFreshness {
  private readonly started = new Map<string, { ref: string; messageId?: string; at: number }>()
  constructor(private readonly now = Date.now) {}

  releaseSession(ref: SessionRef): void {
    const refKey = JSON.stringify([ref.environmentId, ref.sessionId])
    for (const [key, value] of this.started) if (value.ref === refKey) this.started.delete(key)
  }

  observe(ref: SessionRef, event: AgentEvent): ToolAppAttachment | undefined {
    const refKey = JSON.stringify([ref.environmentId, ref.sessionId])
    const now = this.now()
    for (const [key, value] of this.started) if (value.at <= now - 1_800_000) this.started.delete(key)
    if (event.type === 'message_complete' || event.type === 'message_error') {
      for (const [key, value] of this.started) if (value.ref === refKey && value.messageId === event.messageId) this.started.delete(key)
      return
    }
    const callId = event.type === 'codex_item_delta' && event.item.type === 'mcp_tool_call' ? event.item.id
      : event.type === 'content_delta' && (event.delta.type === 'tool_use' || event.delta.type === 'tool_result') ? event.delta.toolUseId : undefined
    if (!callId) return
    const key = JSON.stringify([refKey, callId])
    // UI metadata may first arrive on completion, after a start with no attachment.
    const starting = (event.type === 'codex_item_delta' && event.phase === 'started') || (event.type === 'content_delta' && event.delta.type === 'tool_use')
    const completed = (event.type === 'codex_item_delta' && event.phase === 'completed') || (event.type === 'content_delta' && event.delta.type === 'tool_result')
    if (starting) {
      if (this.started.size >= 1024) this.started.delete(this.started.keys().next().value!)
      this.started.set(key, { ref: refKey, messageId: event.messageId, at: now })
    }
    const app = mcpAppEventAttachment(event)
    const fresh = app && this.started.has(key) ? app : undefined
    if (fresh || completed) this.started.delete(key)
    return fresh
  }
}
