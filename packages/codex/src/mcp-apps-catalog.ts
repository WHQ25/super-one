/** Connection-owned cache survives provider facade recreation, but never a new connection. */
const catalogs = new WeakMap<object, Map<string, { expires: number; value?: Record<string, unknown>[]; pending?: Promise<Record<string, unknown>[]> }>>()
export const CODEX_MCP_APPS_CATALOG_TTL_MS = 5_000

export function invalidateCodexMcpAppsCatalog(connection: object): void { catalogs.delete(connection) }

export function codexMcpAppsCatalog(connection: object, bindingKey: string, load: () => Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> {
  let cache = catalogs.get(connection)
  if (!cache) { cache = new Map(); catalogs.set(connection, cache) }
  const existing = cache.get(bindingKey)
  if (existing?.pending) return existing.pending
  if (existing?.value && existing.expires > Date.now()) return Promise.resolve(existing.value)
  const entry: { expires: number; value?: Record<string, unknown>[]; pending?: Promise<Record<string, unknown>[]> } = { expires: 0 }
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(bindingKey, entry)
  entry.pending = load().then(value => { entry.value = value; entry.expires = Date.now() + CODEX_MCP_APPS_CATALOG_TTL_MS; return value })
    .finally(() => { entry.pending = undefined })
  return entry.pending
}
