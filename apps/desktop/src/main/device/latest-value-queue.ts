interface Waiter<Result> {
  resolve: (result: Result) => void
  reject: (error: unknown) => void
}

interface PendingValue<Value, Result> {
  value: Value
  waiters: Waiter<Result>[]
}

export class LatestValueQueue<Value, Result> {
  private active = false
  private pending: PendingValue<Value, Result> | null = null
  /** Values replaced before they were ever sent — dropped samples, not delayed ones. */
  private dropped = 0
  private readonly idleWaiters = new Set<() => void>()

  constructor(private readonly send: (value: Value) => Promise<Result>) {}

  enqueue(value: Value): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      if (this.pending) {
        this.dropped += 1
        this.pending.value = value
        this.pending.waiters.push({ resolve, reject })
      } else {
        this.pending = { value, waiters: [{ resolve, reject }] }
      }
      this.pump()
    })
  }

  /** Reads the dropped counter and resets it, so each caller sees its own window. */
  takeDroppedCount(): number {
    const dropped = this.dropped
    this.dropped = 0
    return dropped
  }

  flush(): Promise<void> {
    if (!this.active && !this.pending) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.add(resolve))
  }

  private pump(): void {
    if (this.active || !this.pending) return
    const current = this.pending
    this.pending = null
    this.active = true
    void Promise.resolve()
      .then(() => this.send(current.value))
      .then(
        (result) => current.waiters.forEach((waiter) => waiter.resolve(result)),
        (error) => current.waiters.forEach((waiter) => waiter.reject(error)),
      )
      .finally(() => {
        this.active = false
        this.pump()
        if (!this.active && !this.pending) {
          for (const resolve of this.idleWaiters) resolve()
          this.idleWaiters.clear()
        }
      })
  }
}
