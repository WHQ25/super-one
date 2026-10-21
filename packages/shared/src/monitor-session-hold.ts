import type { AgentEvent } from './agent-types'

/**
 * A Grok monitor keeps running after the turn that started it. That turn's
 * `status_change: idle` would mark the session idle. Hold `background` until
 * the last monitor finishes, and do not cover a turn that is still streaming.
 */
export class MonitorSessionHold {
  private readonly ids = new Set<string>()
  private holding = false
  private streaming = false
  /** The status event just published was an error; leave it visible. */
  private suppressFollowUp = false

  note(event: AgentEvent): void {
    if (event.type === 'task_started') {
      if (event.taskType === 'monitor' && event.taskId) this.ids.add(event.taskId)
      return
    }
    if (event.type !== 'task_notification') return
    const status = event.taskStatus
    if ((status === 'completed' || status === 'stopped' || status === 'failed') && event.taskId) {
      this.ids.delete(event.taskId)
    }
  }

  /** Rewrite a terminal idle while a monitor is still running. */
  adjust(event: AgentEvent): AgentEvent {
    this.suppressFollowUp = false
    if (event.type !== 'status_change') return event
    if (event.status === 'streaming') {
      this.streaming = true
      return event
    }
    this.streaming = false
    if (event.status === 'error') {
      this.holding = false
      this.suppressFollowUp = true
      return event
    }
    if (event.status === 'idle' && this.ids.size > 0) {
      this.holding = true
      return { ...event, status: 'background' }
    }
    if (event.status === 'idle') this.holding = false
    return event
  }

  /**
   * Status to publish after `event` was noted and published.
   * Null when the session status should stay as that event left it.
   */
  followUp(): AgentEvent | null {
    if (this.streaming || this.suppressFollowUp) return null
    if (this.ids.size > 0) {
      if (this.holding) return null
      this.holding = true
      return { type: 'status_change', status: 'background' }
    }
    if (!this.holding) return null
    this.holding = false
    return { type: 'status_change', status: 'idle' }
  }

  reset(): void {
    this.ids.clear()
    this.holding = false
    this.streaming = false
    this.suppressFollowUp = false
  }
}
