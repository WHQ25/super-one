/**
 * Share one in-flight computation per key, optionally with a short result TTL.
 *
 * Git reads are triggered per session pane, and every pane reacts to the same
 * store change in the same tick — six panes asking for the same repo's status
 * used to mean six `git status` subprocesses with byte-identical output. Since
 * concurrent callers by definition want the same snapshot, they can share one.
 *
 * `ttlMs: 0` means in-flight sharing only, with no caching — the right default
 * when a caller may be refreshing precisely because it just mutated the repo.
 */
export class AsyncCoalescer<T> {
  private readonly cache = new Map<string, { at: number; value: T }>()
  private readonly inFlight = new Map<string, Promise<T>>()

  constructor(private readonly ttlMs = 0) {}

  get(key: string, compute: () => Promise<T>): Promise<T> {
    if (this.ttlMs > 0) {
      const hit = this.cache.get(key)
      if (hit && Date.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value)
    }

    const running = this.inFlight.get(key)
    if (running) return running

    const promise = compute()
      .then((value) => {
        if (this.ttlMs > 0) this.cache.set(key, { at: Date.now(), value })
        return value
      })
      .finally(() => {
        if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
      })

    this.inFlight.set(key, promise)
    return promise
  }

  /** Drop a cached result. In-flight work is left alone — it is already the newest read. */
  invalidate(key: string): void {
    this.cache.delete(key)
  }

  /** Drop all cached results (tests / host disconnect). */
  clear(): void {
    this.cache.clear()
  }
}
