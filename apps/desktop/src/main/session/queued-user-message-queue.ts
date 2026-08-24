import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'

/**
 * Host-owned mid-turn queue for user-typed messages. ACP/Grok and OpenCode
 * always run a queued message as its own turn once the live one settles. Claude
 * does the same by default, but can remove one item and inject it into the live
 * SDK stream as `priority: 'now'`. Codex owns a separate durable Core queue.
 * Sending concurrently is actively harmful — Grok cancels the live turn and
 * OpenCode rejects the send outright.
 *
 * `Session.send` routes `priority: 'next'` straight to `backend.send`, so each
 * backend owns this policy. Wire it as:
 *
 * ```ts
 * async send(request) {
 *   if (this.queuedMessages.intercept(request)) return
 *   …
 *   finally { this.queuedMessages.flush() }
 * }
 * ```
 */
export class QueuedUserMessageQueue {
  private items: SendMessageRequest[] = []

  constructor(private readonly host: {
    /** True while a turn is active — a queued message must wait. */
    isBusy(): boolean
    /** False once the backend is closed/disposed — drop queued work. */
    isAlive(): boolean
    emit(event: AgentEvent): void
    /** Re-entry point; receives the original request (priority intact). */
    send(request: SendMessageRequest): Promise<void>
    warn(message: string, err: unknown): void
  }) {}

  get size(): number {
    return this.items.length
  }

  /**
   * Call first in `send()`. Returns true when the request was parked and the
   * caller must return immediately.
   *
   * When not busy this emits `queued_message_consumed` and returns false so the
   * turn runs normally — Session holds the user bubble in `_pendingQueuedRequests`
   * until that event lands, and its `isStreaming()` check can be a tick ahead of
   * the backend, so the event must fire on this path too.
   */
  intercept(request: SendMessageRequest): boolean {
    if (request.priority !== 'next' && request.priority !== 'later') return false
    if (this.host.isBusy()) {
      this.items.push(request)
      return true
    }
    if (request.clientMessageId) {
      this.host.emit({ type: 'queued_message_consumed', clientMessageId: request.clientMessageId })
    }
    return false
  }

  /** Call from the `finally` of `send()`, once the turn state is cleared. */
  flush(): void {
    if (this.items.length === 0) return
    if (!this.host.isAlive()) {
      this.clear()
      return
    }
    const next = this.items.shift()!
    void this.host.send(next).catch((err) => {
      this.host.warn('queued send failed', err)
    })
  }

  /** User cancelled a still-queued message from the composer. */
  dequeue(clientMessageId: string): boolean {
    return this.take(clientMessageId) !== null
  }

  /** Remove and return one queued request for a harness-specific action. */
  take(clientMessageId: string): { request: SendMessageRequest; index: number } | null {
    const idx = this.items.findIndex((r) => r.clientMessageId === clientMessageId)
    if (idx === -1) return null
    const request = this.items.splice(idx, 1)[0]
    return request ? { request, index: idx } : null
  }

  /** Restore a request removed by `take()` when the follow-up action fails. */
  restore(taken: { request: SendMessageRequest; index: number }): void {
    this.items.splice(Math.min(taken.index, this.items.length), 0, taken.request)
  }

  clear(): void {
    this.items = []
  }
}
