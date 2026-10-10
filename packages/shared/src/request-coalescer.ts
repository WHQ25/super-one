/** `value` with object keys sorted and undefined fields dropped, so equal requests stringify alike. */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalJson(v)]))
}

/**
 * Identical reads in flight share one request. The caller picks the key, and
 * passes null for anything that must run on its own (a mutation, a read with
 * side effects). One instance per connection; a settled read is never reused.
 */
export class RequestCoalescer {
  private readonly pending = new Map<string, Promise<unknown>>()

  run<T>(key: string | null, read: () => Promise<T>): Promise<T> {
    if (key === null) return read()
    const hit = this.pending.get(key)
    if (hit) return hit as Promise<T>
    const promise = read().finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }

  clear(): void {
    this.pending.clear()
  }
}
