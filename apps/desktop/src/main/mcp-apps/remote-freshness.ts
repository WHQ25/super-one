import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

/** Live start/completion pairing, with bounded retention for interrupted streams. */
export class RemoteMcpAppFreshness {
  private readonly started = new Map<string, { ref: string; messageId?: string; at: number; activated?: boolean }>()
  constructor(private readonly now = Date.now) {}

  releaseSession(ref: SessionRef): void {
    const refKey = JSON.stringify([ref.environmentId, ref.sessionId])
    for (const [key, value] of this.started) if (value.ref === refKey) this.started.delete(key)
  }

  observe(ref: SessionRef, event: AgentEvent): ToolAppAttachment | undefined {
    return this.observeAll(ref, event)[0]
  }

  observeAll(ref: SessionRef, event: AgentEvent): ToolAppAttachment[] {
    const refKey = JSON.stringify([ref.environmentId, ref.sessionId])
    const now = this.now()
    for (const [key, value] of this.started) if (value.at <= now - 1_800_000) this.started.delete(key)
    if (event.type === 'message_complete' || event.type === 'message_error') {
      for (const [key, value] of this.started) if (value.ref === refKey && value.messageId === event.messageId) this.started.delete(key)
      return []
    }
    const fresh: ToolAppAttachment[] = []
    const messageId = 'messageId' in event ? event.messageId ?? undefined : undefined
    const observeCall = (callId: string, app: ToolAppAttachment | undefined, starting: boolean, completed: boolean) => {
      const key = JSON.stringify([refKey, callId])
      // A collab snapshot can repeat the same pending child; it is still one live call.
      if (starting && !this.started.has(key)) {
        if (this.started.size >= 1024) this.started.delete(this.started.keys().next().value!)
        this.started.set(key, { ref: refKey, messageId, at: now })
      }
      const entry = this.started.get(key)
      if (app && entry && !entry.activated) { fresh.push(app); entry.activated = true }
      if (completed) this.started.delete(key)
    }
    if (event.type === 'codex_item_delta') {
      const visit = (item: CodexThreadItem, childThreadId?: string) => {
        if (item.type === 'mcp_tool_call') observeCall(JSON.stringify([childThreadId ?? '', item.id]), item.app,
          childThreadId ? item.status === 'in_progress' : event.phase === 'started',
          childThreadId ? item.status !== 'in_progress' : event.phase === 'completed')
        else if (item.type === 'collab_tool_call') for (const [threadId, items] of Object.entries(item.childItems ?? {})) for (const child of items) visit(child, threadId)
      }
      visit(event.item)
    } else if (event.type === 'content_delta' && (event.delta.type === 'tool_use' || event.delta.type === 'tool_result')) {
      observeCall(event.delta.toolUseId, event.delta.app, event.delta.type === 'tool_use', event.delta.type === 'tool_result')
    }
    return fresh
  }
}
