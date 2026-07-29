/**
 * Per-resource serial lanes + monotonic epoch.
 *
 * Mutation protocol (matches pi-computer-use):
 * 1. Caller supplies the epoch captured by its base state.
 * 2. Scheduler rejects stale epochs before any side effect.
 * 3. On accept, epoch advances *before* dispatch so competing writers fail even
 *    if the native call later yields unknown.
 */

export class ResourceScheduler {
  private readonly epochs = new Map<string, number>()
  private readonly tails = new Map<string, Promise<unknown>>()

  /** Current epoch for a resource (0 if never seen). */
  epoch(resourceKey: string): number {
    return this.epochs.get(resourceKey) ?? 0
  }

  /** Ensure a resource exists at least at epoch 0. */
  ensure(resourceKey: string): number {
    if (!this.epochs.has(resourceKey)) this.epochs.set(resourceKey, 0)
    return this.epochs.get(resourceKey)!
  }

  /**
   * Claim a mutation slot for `resourceKey` at `expectedEpoch`.
   * Advances epoch on success. Throws `{ code: 'STALE_STATE' }` on mismatch.
   */
  claimWrite(resourceKey: string, expectedEpoch: number): number {
    const current = this.ensure(resourceKey)
    if (expectedEpoch !== current) {
      const err = new Error(
        `Stale state: resource ${resourceKey} is at epoch ${current}, action based on ${expectedEpoch}`,
      ) as Error & { code: 'STALE_STATE'; resourceKey: string; currentEpoch: number; expectedEpoch: number }
      err.code = 'STALE_STATE'
      err.resourceKey = resourceKey
      err.currentEpoch = current
      err.expectedEpoch = expectedEpoch
      throw err
    }
    const next = current + 1
    this.epochs.set(resourceKey, next)
    return next
  }

  /**
   * Run `fn` on the resource's serial lane. Read operations may skip claimWrite;
   * writes must call claimWrite inside `fn` before side effects.
   */
  async runExclusive<T>(resourceKey: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(resourceKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = prev.then(() => gate, () => gate)
    this.tails.set(resourceKey, tail)

    await prev.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      if (this.tails.get(resourceKey) === tail) this.tails.delete(resourceKey)
    }
  }

  reset(): void {
    this.epochs.clear()
    this.tails.clear()
  }
}
