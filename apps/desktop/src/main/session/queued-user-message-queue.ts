import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import type { SendDelivery } from './types'

/** A parked send and the delivery hooks of the `Session.send` that parked it. */
export interface QueuedUserMessage {
  request: SendMessageRequest
  delivery?: SendDelivery
}

/**
 * Host-owned mid-turn queue for user-typed messages. OpenCode always runs a
 * queued message as its own turn once the live one settles. ACP/Grok does the
 * same by default; `acp.steer_queued` can pull one item and `x.ai/interject`
 * it into the live prompt. Claude queues too, then injects as SDK
 * `priority: 'now'` / `'next'`. Codex owns a separate durable Core queue.
 * Sending concurrently is actively harmful — Grok cancels the live turn and
 * OpenCode rejects the send outright.
 *
 * `Session.send` routes `priority: 'next'` straight to `backend.send`, so each
 * backend owns this policy. Wire it as:
 *
 * ```ts
 * async send(request, delivery) {
 *   if (this.queuedMessages.intercept(request, delivery)) return
 *   …
 *   finally { this.queuedMessages.flush() }
 * }
 * ```
 *
 * Claude flushes from its terminal-event handler instead: a steered message
 * runs as a continuation turn that no `send()` awaits.
 *
 * Each item keeps the `SendDelivery` of the send that parked it. The parking
 * call has long returned when the item runs, so the flush runs it through
 * `delivery.runDeferred`, which ties that run's events and failure back to
 * the message; a steer that hands the item to the live turn calls its
 * `onInputAccepted`.
 */
export interface TakenQueuedUserMessage extends QueuedUserMessage {
  index: number
}

export class QueuedUserMessageQueue {
  private items: QueuedUserMessage[] = []

  constructor(private readonly host: {
    /** True while a turn is active — a queued message must wait. */
    isBusy(): boolean
    /** False once the backend is closed/disposed — drop queued work. */
    isAlive(): boolean
    emit(event: AgentEvent): void
    /** Re-entry point; receives the original request (priority intact). */
    send(request: SendMessageRequest, delivery?: SendDelivery): Promise<void>
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
  intercept(request: SendMessageRequest, delivery?: SendDelivery): boolean {
    if (request.priority !== 'next' && request.priority !== 'later') return false
    if (this.host.isBusy()) {
      this.items.push({ request, delivery })
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
    const { request, delivery } = this.items.shift()!
    const run = () => this.host.send(request, delivery)
    void (delivery?.runDeferred ? delivery.runDeferred(run) : run()).catch((err) => {
      this.host.warn('queued send failed', err)
    })
  }

  /** User cancelled a still-queued message from the composer. */
  dequeue(clientMessageId: string): boolean {
    return this.take(clientMessageId) !== null
  }

  /** Remove and return one queued request for a harness-specific action. */
  take(clientMessageId: string): TakenQueuedUserMessage | null {
    const idx = this.items.findIndex((item) => item.request.clientMessageId === clientMessageId)
    if (idx === -1) return null
    const item = this.items.splice(idx, 1)[0]
    return item ? { ...item, index: idx } : null
  }

  /** Restore a request removed by `take()` when the follow-up action fails. */
  restore(taken: TakenQueuedUserMessage): void {
    const { index, ...item } = taken
    this.items.splice(Math.min(index, this.items.length), 0, item)
  }

  clear(): void {
    this.items = []
  }
}
