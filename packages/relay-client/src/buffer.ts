/**
 * Buffer-first open/reconnect. All type=event frames enqueue until
 * history + snapshot are applied, then release in order and bump epoch.
 */
export class EventBuffer {
  private buffering = false
  private queue: unknown[][] = []
  epoch = 0

  start(): void {
    if (this.buffering) return
    this.buffering = true
    this.queue = []
  }

  /** Server reset invalidates every pre-reset live batch. */
  restart(): void {
    this.buffering = true
    this.queue = []
  }

  stop(): void {
    this.buffering = false
    this.queue = []
  }

  push(events: unknown[]): void {
    if (this.buffering) this.queue.push(events)
  }

  get isBuffering(): boolean {
    return this.buffering
  }

  /** History + snapshot done. Returns queued batches and bumps epoch. */
  release(): { epoch: number; batches: unknown[][] } {
    if (!this.buffering) return { epoch: this.epoch, batches: [] }
    const batches = this.queue
    this.queue = []
    this.buffering = false
    this.epoch += 1
    return { epoch: this.epoch, batches }
  }
}

export type RestoreStep = 'subscribe' | 'history' | 'snapshot' | 'release'

export const BUFFER_FIRST_ORDER: RestoreStep[] = ['subscribe', 'history', 'snapshot', 'release']
