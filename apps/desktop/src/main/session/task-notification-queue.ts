import type { SendMessageRequest } from '@superone/shared/agent-types'

/** `userAuthored` marks a wake whose text the user wrote; the transcript shows it. */
export interface TaskNotificationOptions {
  userAuthored?: boolean
}

export interface QueuedTaskNotification extends TaskNotificationOptions {
  content: string
}

function sameNotification(a: QueuedTaskNotification | undefined, b: QueuedTaskNotification): boolean {
  return a !== undefined && a.content === b.content && Boolean(a.userAuthored) === Boolean(b.userAuthored)
}

/** Drop oldest when the queue grows past this (mailbox wakes + download settles). */
export const TASK_NOTIFICATION_MAX_ITEMS = 32
/** Give up after this many failed flush attempts for the current backlog. */
export const TASK_NOTIFICATION_MAX_ATTEMPTS = 5
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 8_000

/**
 * Coalescing queue for host-injected task notifications (collaboration mailbox
 * wake, browser download settle, etc.). Consecutive identical payloads collapse
 * so repeated "mailbox ready" wakes during one turn only fire once.
 *
 * Use {@link takeBatch} + {@link requeueFront} (not a fire-and-forget drain) so a
 * failed send can restore the batch instead of permanently losing it.
 */
export class TaskNotificationQueue {
  private items: QueuedTaskNotification[] = []

  constructor(private readonly maxItems: number = TASK_NOTIFICATION_MAX_ITEMS) {}

  enqueue(content: string, opts?: TaskNotificationOptions): void {
    const text = content.trim()
    if (!text) return
    const item: QueuedTaskNotification = { content: text, ...(opts?.userAuthored ? { userAuthored: true } : {}) }
    if (sameNotification(this.items[this.items.length - 1], item)) return
    this.items.push(item)
    while (this.items.length > this.maxItems) this.items.shift()
  }

  get size(): number {
    return this.items.length
  }

  /** Snapshot of queued items (tests / debugging). */
  peekAll(): readonly QueuedTaskNotification[] {
    return this.items
  }

  /**
   * Remove and return the leading run that shares one visibility, so a
   * user-authored wake never joins a model-only one in a single turn.
   * On failure the caller must {@link requeueFront} to preserve delivery.
   */
  takeBatch(): QueuedTaskNotification[] {
    const first = this.items[0]
    if (!first) return []
    const end = this.items.findIndex((item) => Boolean(item.userAuthored) !== Boolean(first.userAuthored))
    const batch = end === -1 ? this.items : this.items.slice(0, end)
    this.items = end === -1 ? [] : this.items.slice(end)
    return batch
  }

  /**
   * Restore a failed batch in front of any items enqueued while send was in
   * flight. Consecutive duplicates across the boundary are coalesced; excess
   * over capacity drops the oldest entries.
   */
  requeueFront(batch: QueuedTaskNotification[]): void {
    if (batch.length === 0) return
    const merged: QueuedTaskNotification[] = []
    for (const item of [...batch, ...this.items]) {
      if (sameNotification(merged[merged.length - 1], item)) continue
      merged.push(item)
    }
    this.items = merged.length > this.maxItems
      ? merged.slice(merged.length - this.maxItems)
      : merged
  }

  static join(batch: readonly QueuedTaskNotification[]): string {
    return batch.map((item) => item.content).join('\n\n')
  }

  clear(): void {
    this.items = []
  }
}

export interface TaskNotificationFlushHost {
  /** True while a turn/prompt is active — flush must wait. */
  isBusy(): boolean
  /** False when the backend is closed/disposed — stop retrying and drop work. */
  isAlive(): boolean
  send(content: string, opts: TaskNotificationOptions): Promise<void>
}

/**
 * Owns flush-in-flight + limited backoff so a transient send failure requeues
 * instead of losing mailbox/download wakes forever.
 */
export class TaskNotificationFlush {
  private flushing = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private closed = false

  constructor(
    private readonly queue: TaskNotificationQueue,
    private readonly host: TaskNotificationFlushHost,
    private readonly opts: {
      logLabel: string
      warn: (message: string) => void
      maxAttempts?: number
      baseDelayMs?: number
      maxDelayMs?: number
    },
  ) {}

  get isFlushing(): boolean {
    return this.flushing
  }

  flush(): void {
    if (this.closed || this.flushing) return
    if (!this.host.isAlive()) return
    if (this.host.isBusy()) return
    if (this.queue.size === 0) return

    const batch = this.queue.takeBatch()
    if (batch.length === 0) return
    const content = TaskNotificationQueue.join(batch)
    this.flushing = true
    this.clearRetryTimer()

    let failed = false
    void this.host.send(content, batch[0].userAuthored ? { userAuthored: true } : {})
      .then(() => {
        this.attempt = 0
      })
      .catch((err) => {
        failed = true
        const msg = err instanceof Error ? err.message : String(err)
        this.opts.warn(`[${this.opts.logLabel}] pending task notification send failed: ${msg}`)
        if (this.closed || !this.host.isAlive()) {
          // Batch already taken; host is gone — drop without requeue.
          this.attempt = 0
          return
        }
        this.attempt += 1
        const maxAttempts = this.opts.maxAttempts ?? TASK_NOTIFICATION_MAX_ATTEMPTS
        if (this.attempt >= maxAttempts) {
          this.opts.warn(
            `[${this.opts.logLabel}] dropping ${batch.length} task notification(s) after ${maxAttempts} failed sends`,
          )
          this.attempt = 0
          // Do not requeue — permanent drop after budget exhausted.
          return
        }
        this.queue.requeueFront(batch)
        this.scheduleRetry()
      })
      .finally(() => {
        this.flushing = false
        // On success, immediately drain anything enqueued during the send.
        // On failure, scheduleRetry owns the next attempt (avoid tight loops).
        if (!failed && !this.closed && this.host.isAlive() && this.queue.size > 0) {
          this.flush()
        }
      })
  }

  private scheduleRetry(): void {
    if (this.closed) return
    const base = this.opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    const max = this.opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    // attempt is already the number of failures so far (1-based).
    const delay = Math.min(max, base * 2 ** Math.max(0, this.attempt - 1))
    this.clearRetryTimer()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.flush()
    }, delay)
    this.retryTimer.unref?.()
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /** Cancel retries and clear the queue (backend close). */
  dispose(): void {
    this.closed = true
    this.clearRetryTimer()
    this.queue.clear()
    this.attempt = 0
    this.flushing = false
  }
}

export function taskNotificationRequest(content: string, opts?: TaskNotificationOptions): SendMessageRequest {
  return {
    content,
    clientMessageId: `task-notify-${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'task-notification',
    ...(opts?.userAuthored ? { userAuthored: true } : {}),
  }
}

/**
 * The user bubble for a host wake prompt. The full prompt still goes to the
 * model via SendMessageRequest.content.
 */
export function taskNotificationDisplayText(content: string): string {
  return content
    // Grok cron inject wraps the user prompt in `<system-reminder>`; the bubble
    // should show only the scheduled prompt, matching Grok TUI's cron_prompt block.
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
