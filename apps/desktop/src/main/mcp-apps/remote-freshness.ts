import type { AgentEvent } from '@superone/shared/agent-types'
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
      // Repeated deltas of a pending call are still one live call.
      if (starting && !this.started.has(key)) {
        if (this.started.size >= 1024) this.started.delete(this.started.keys().next().value!)
        this.started.set(key, { ref: refKey, messageId, at: now })
      }
      const entry = this.started.get(key)
      if (app && entry && !entry.activated) { fresh.push(app); entry.activated = true }
      if (completed) this.started.delete(key)
    }
    if (event.type === 'content_delta' && (event.delta.type === 'tool_use' || event.delta.type === 'tool_result')) {
      // A call first seen already complete is history, not a live start.
      const starting = event.delta.type === 'tool_use' && event.delta.status !== 'complete'
      observeCall(event.delta.toolUseId, event.delta.app, starting, event.delta.type === 'tool_result')
    }
    return fresh
  }
}
