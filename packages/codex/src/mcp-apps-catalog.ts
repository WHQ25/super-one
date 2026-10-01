/** Connection-owned cache survives provider facade recreation, but never a new connection. */
const catalogs = new WeakMap<object, Map<string, { value?: Record<string, unknown>[]; pending?: Promise<Record<string, unknown>[]> }>>()
const refreshTimes = new WeakMap<object, Map<string, number>>()
const MISS_REFRESH_INTERVAL_MS = 10_000

export function invalidateCodexMcpAppsCatalog(connection: object): void { catalogs.delete(connection); refreshTimes.delete(connection) }

export function codexMcpAppsCatalog(connection: object, bindingKey: string, load: () => Promise<Record<string, unknown>[]>, refreshSession?: string): Promise<Record<string, unknown>[]> {
  let cache = catalogs.get(connection)
  if (!cache) { cache = new Map(); catalogs.set(connection, cache) }
  const existing = cache.get(bindingKey)
  if (existing?.pending) return existing.pending
  if (existing?.value) {
    if (!refreshSession) return Promise.resolve(existing.value)
    let times = refreshTimes.get(connection)
    if (!times) { times = new Map(); refreshTimes.set(connection, times) }
    const now = Date.now(), previous = times.get(refreshSession)
    if (previous !== undefined && now - previous < MISS_REFRESH_INTERVAL_MS) return Promise.resolve(existing.value)
    if (times.size >= 128 && !times.has(refreshSession)) times.delete(times.keys().next().value!)
    times.set(refreshSession, now)
  }
  const entry: { value?: Record<string, unknown>[]; pending?: Promise<Record<string, unknown>[]> } = {}
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(bindingKey, entry)
  // Binding keys include the thread and configuration fingerprint. Reload, reconnect
  // and sign-in invalidate the connection; elapsed time alone must not rediscover
  // every configured MCP server on the View's request path.
  entry.pending = load().then(value => { entry.value = value; return value })
    .catch(error => { if (cache.get(bindingKey) === entry) cache.delete(bindingKey); throw error })
    .finally(() => { entry.pending = undefined })
  return entry.pending
}
