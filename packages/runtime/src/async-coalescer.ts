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
 * A function TTL is per key, so one coalescer can keep some lists forever and
 * let others expire.
 *
 * `invalidate` / `clear` bump that key's generation. An in-flight compute that
 * started earlier still resolves for the callers that already joined it, but
 * its result is not cached, and the next `get` starts a fresh compute instead
 * of joining the stale promise. A read that began before the mutation is not
 * the newest read.
 */
export class AsyncCoalescer<T> {
  private readonly cache = new Map<string, { at: number; value: T }>()
  private readonly inFlight = new Map<string, { generation: number; promise: Promise<T>; force: boolean }>()
  private readonly generation = new Map<string, number>()

  constructor(private readonly ttlMs: number | ((key: string) => number) = 0) {}

  private ttlFor(key: string): number {
    return typeof this.ttlMs === 'function' ? this.ttlMs(key) : this.ttlMs
  }

  private generationOf(key: string): number {
    return this.generation.get(key) ?? 0
  }

  private bump(key: string): void {
    this.generation.set(key, this.generationOf(key) + 1)
  }

  private readFresh(key: string): { value: T } | null {
    const ttl = this.ttlFor(key)
    if (!(ttl > 0)) return null
    const hit = this.cache.get(key)
    if (!hit) return null
    if (Number.isFinite(ttl) && Date.now() - hit.at >= ttl) return null
    return hit
  }

  /** Cached value still inside its TTL, if any. */
  peek(key: string): T | undefined {
    return this.readFresh(key)?.value
  }

  /**
   * Remember a value the caller already fetched. An older in-flight result
   * will not overwrite it.
   */
  remember(key: string, value: T): void {
    if (this.ttlFor(key) > 0) this.cache.set(key, { at: Date.now(), value })
    this.bump(key)
    this.inFlight.delete(key)
  }

  /** True when a compute for the current generation is still running. */
  isInFlight(key: string): boolean {
    const running = this.inFlight.get(key)
    return !!running && running.generation === this.generationOf(key)
  }

  get(key: string, compute: () => Promise<T>, options?: {
    /** Skip a warm cache. A forced read already in flight is shared; an ordinary one is not. */
    force?: boolean
    /** Return false to resolve this value without caching it. */
    cacheIf?: (value: T) => boolean
  }): Promise<T> {
    const force = options?.force === true
    if (!force) {
      const hit = this.readFresh(key)
      if (hit) return Promise.resolve(hit.value)
    } else {
      this.cache.delete(key)
    }

    const generation = this.generationOf(key)
    const running = this.inFlight.get(key)
    if (running && running.generation === generation && (running.force || !force)) {
      return running.promise
    }

    // A forced read must not let the ordinary in-flight result land in the cache.
    let started = generation
    if (force && running && running.generation === generation && !running.force) {
      this.bump(key)
      started = this.generationOf(key)
    }
    const cacheIf = options?.cacheIf

    const promise = compute()
      .then((value) => {
        if (
          this.generationOf(key) === started
          && this.ttlFor(key) > 0
          && (!cacheIf || cacheIf(value))
        ) {
          this.cache.set(key, { at: Date.now(), value })
        }
        return value
      })
      .finally(() => {
        if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key)
      })

    this.inFlight.set(key, { generation: started, promise, force })
    return promise
  }

  /** Drop a cached result and detach the in-flight compute so the next get starts over. */
  invalidate(key: string): void {
    this.cache.delete(key)
    this.bump(key)
    this.inFlight.delete(key)
  }

  /** Drop every cached key that matches. In-flight computes for those keys are detached too. */
  invalidateMatching(match: (key: string) => boolean): void {
    const keys = new Set([...this.cache.keys(), ...this.inFlight.keys(), ...this.generation.keys()])
    for (const key of keys) if (match(key)) this.invalidate(key)
  }

  /** Drop all cached results (tests / host disconnect). */
  clear(): void {
    this.cache.clear()
    for (const key of this.inFlight.keys()) this.bump(key)
    this.inFlight.clear()
  }
}
