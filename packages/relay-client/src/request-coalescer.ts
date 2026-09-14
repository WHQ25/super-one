const READS = new Set(['get_git_info', 'get_system_info', 'get_project_resources', 'list_sessions', 'list_drafts', 'list_pinned_sessions'])

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
}

/** One instance per client; never memoize a completed read or a mutation. */
export class RequestCoalescer {
  private pending = new Map<string, Promise<unknown>>()

  run(command: { type: string; [key: string]: unknown }, timeoutMs: number, read: () => Promise<unknown>): Promise<unknown> {
    if (!READS.has(command.type)) return read()
    const { requestId: _requestId, ...parameters } = command
    const key = JSON.stringify([canonical(parameters), timeoutMs])
    const hit = this.pending.get(key)
    if (hit) return hit
    const promise = read().finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }

  clear(): void { this.pending.clear() }
}
