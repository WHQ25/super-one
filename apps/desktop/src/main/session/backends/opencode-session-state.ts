import type { AgentEvent } from '@superone/shared/agent-types'
import type { HarnessConnectionState, SessionInboxItem } from '@superone/shared/session-inbox'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent } from '../../opencode/opencode-runtime'

/** Native provider state is independent of the host-held composer queue. */
export class OpenCodeSessionState {
  private items: SessionInboxItem[] = []
  private connection: HarnessConnectionState = { state: 'connected', attempt: 0 }
  constructor(private readonly runtime: () => OpenCodeRuntime | null, private readonly emit: (event: AgentEvent) => void) {}

  route(event: OpenCodeRuntimeEvent) {
    if (event.type === 'runtime.inbox') {
      this.items = event.properties.items
      this.emit({ type: 'session_inbox_changed', items: this.items })
      return true
    }
    if (event.type === 'runtime.connection') {
      this.connection = event.properties
      this.emit({ type: 'harness_connection_changed', connection: this.connection })
      return true
    }
    return false
  }

  snapshot(): AgentEvent[] {
    return [...(this.items.length ? [{ type: 'session_inbox_changed' as const, items: this.items }] : []),
      ...(this.connection.state !== 'connected' ? [{ type: 'harness_connection_changed' as const, connection: this.connection }] : [])]
  }
  reset() {
    if (this.items.length) this.emit({ type: 'session_inbox_changed', items: [] })
    if (this.connection.state !== 'connected') this.emit({ type: 'harness_connection_changed', connection: { state: 'connected', attempt: 0 } })
    this.items = []; this.connection = { state: 'connected', attempt: 0 }
  }
  appendInput(item: SessionInboxItem) {
    this.emit({ type: 'user_message_appended', message: {
      id: item.clientMessageId ?? item.id, role: 'user', status: 'complete', providerId: 'opencode',
      createdAt: new Date(item.createdAt).toISOString(), content: [{ type: 'text', text: item.text }],
      checkpointId: item.id, resumePointId: item.id,
    } })
  }
  listInbox() { return this.runtime()?.listInbox?.() ?? Promise.resolve([]) }
  async cancelInbox(id: string, assertControl: () => void) {
    const runtime = this.runtime()
    if (!runtime?.cancelInbox) throw new Error('This session does not support native pending input')
    await runtime.cancelInbox(id, assertControl)
  }
  async updateInbox(id: string, delivery: 'steer' | 'queue', assertControl: () => void) {
    const runtime = this.runtime()
    if (!runtime?.updateInbox) throw new Error('This session does not support native pending input')
    await runtime.updateInbox(id, delivery, assertControl)
  }
}
