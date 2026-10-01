import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ToolAppAttachment } from '@superone/shared/mcp-apps'

const CALL_NAME = 'mcp__superone__miniapp_call'
const MAX_PENDING_RECORDS = 32
const PENDING_TTL_MS = 5 * 60_000
// Cursor sometimes serializes its {content,isError} envelope as pretty JSON.
// Accept only its first text block, never an echoed marker buried in tool text.
const MARKER = /^(?:\{\s*"content":\s*\[\s*\{\s*"type":\s*"text",\s*"text":\s*")?\[superone-mcp-app:([0-9a-f-]{36})\]/

/** The host owns records. Server-authored metadata can never create an attachment. */
export class CompatRecords {
  private readonly pending = new Map<string, { app: ToolAppAttachment; expiresAt: number }>()
  private readonly calls = new Map<string, string>()
  private expiryTimer?: ReturnType<typeof setTimeout>
  constructor(private readonly sessionId: string) {}

  record(app: Omit<ToolAppAttachment, 'appInstanceId' | 'gatewayCallId'>): { id: string; marker: string } {
    this.pruneExpired()
    if (this.pending.size >= MAX_PENDING_RECORDS) this.pending.delete(this.pending.keys().next().value!)
    const id = randomUUID()
    this.pending.set(id, { app: { ...app, appInstanceId: id, gatewayCallId: id }, expiresAt: Date.now() + PENDING_TTL_MS })
    this.scheduleExpiry()
    return { id, marker: `[superone-mcp-app:${id}]` }
  }

  attach(event: AgentEvent): AgentEvent {
    if (event.sessionId && event.sessionId !== this.sessionId) return event
    if (event.type === 'message_complete') {
      for (const [id, messageId] of this.calls) if (messageId === event.messageId) this.calls.delete(id)
      return event
    }
    if (event.type !== 'content_delta') return event
    if (event.delta.type === 'tool_use') {
      if (event.delta.toolName === CALL_NAME) this.calls.set(event.delta.toolUseId, event.messageId)
      else this.calls.delete(event.delta.toolUseId)
      return event
    }
    if (event.delta.type !== 'tool_result' || this.calls.get(event.delta.toolUseId) !== event.messageId) return event
    this.pruneExpired()
    // The marker is the first content block so Cursor's 48k summary cap cannot cut it off.
    const id = MARKER.exec(event.delta.summary)?.[1]
    const app = id ? this.pending.get(id)?.app : undefined
    if (!app) { this.calls.delete(event.delta.toolUseId); return event }
    this.pending.delete(id!)
    this.scheduleExpiry()
    this.calls.delete(event.delta.toolUseId)
    return { ...event, delta: { ...event.delta, app: { ...app, harnessCallId: event.delta.toolUseId } } }
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(id)
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    if (!this.pending.size) return
    const nextExpiry = Math.min(...Array.from(this.pending.values(), entry => entry.expiresAt))
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      this.pruneExpired()
      this.scheduleExpiry()
    }, Math.max(0, nextExpiry - Date.now()))
    this.expiryTimer.unref()
  }

  clear(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    this.pending.clear()
    this.calls.clear()
  }
}
