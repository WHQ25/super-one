import type { AgentEvent } from '@superone/shared/agent-types'
import type { OpenCodeV2Event } from './opencode-v2-types'

/** Completion waits for a steer receipt and delivery; a new execution replaces old completion. */
export class OpenCodeSteeringGate {
  private submitting = false
  private deferred = false
  private readonly pending = new Set<string>()
  private readonly delivered = new Set<string>()
  private readonly observedUsers = new Set<string>()
  private checkpoints: AgentEvent[] = []
  constructor(private readonly complete: () => void, private readonly emit: (event: AgentEvent) => void) {}
  begin() {
    if (this.submitting) throw new Error('Another OpenCode steering input is being submitted')
    this.submitting = true
  }
  hold(interrupted: boolean) {
    if (interrupted) { this.clear(); return false }
    if (!this.submitting && !this.pending.size) return false
    this.deferred = true
    return true
  }
  buffer(event: AgentEvent) {
    if (!this.submitting || event.type !== 'checkpoint_captured') return false
    this.checkpoints.push(event)
    return true
  }
  observe(event: OpenCodeV2Event) {
    if (event.type === 'session.execution.started') this.deferred = false
    if (event.type === 'session.inbox.enqueued' && this.submitting && event.data.item.type === 'user') this.pending.add(event.data.inboxID)
    if (event.type === 'session.inbox.enqueued' && this.submitting && event.data.item.type === 'user'
      && typeof event.data.item.payload?.metadata?.superoneClientMessageId === 'string')
      this.observedUsers.add(event.data.item.payload.metadata.superoneClientMessageId)
    if (event.type === 'session.inbox.delivered') { this.delivered.add(event.data.inboxID); this.pending.delete(event.data.inboxID) }
    if (event.type === 'session.inbox.cancelled') { this.delivered.add(event.data.inboxID); this.pending.delete(event.data.inboxID); this.flush() }
  }
  admitted(id: string) { if (!this.delivered.has(id)) this.pending.add(id) }
  withdraw(id: string) { this.pending.delete(id) }
  consumed() { for (const event of this.checkpoints.splice(0)) this.emit(event) }
  wasAdmitted(userId: string) { return this.observedUsers.has(userId) }
  rejected(userId: string) {
    for (const event of this.checkpoints.splice(0))
      if (event.type !== 'checkpoint_captured' || event.userMessageId !== userId) this.emit(event)
  }
  end() { this.submitting = false; this.flush() }
  clear() { this.submitting = false; this.deferred = false; this.pending.clear(); this.delivered.clear(); this.observedUsers.clear(); this.checkpoints = [] }
  private flush() {
    if (!this.deferred || this.submitting || this.pending.size) return
    this.deferred = false
    this.complete()
  }
}
