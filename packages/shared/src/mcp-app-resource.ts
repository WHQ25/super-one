import { assertMcpAppSize, MCP_APP_HTML_MAX_BYTES, McpAppsError, type McpUiResourceMeta, type ToolAppAttachment } from './mcp-apps'

/** New history stores a reference; inline HTML remains readable for older snapshots. */
export interface McpAppResource { hash: string; meta: McpUiResourceMeta; html?: string }
export interface McpAppResourceSnapshot extends McpAppResource { html: string }
export interface McpAppResourceStore {
  put(snapshot: McpAppResourceSnapshot): McpAppResource
  hydrate(resource: McpAppResource): McpAppResourceSnapshot
  collect(references: Iterable<string>, graceMs?: number): number
}

export function validateMcpAppResource(resource: McpAppResource): void {
  if (typeof resource.hash !== 'string' || !resource.hash || resource.hash.length > 128) throw new McpAppsError('invalid', 'Invalid MCP App resource hash')
  assertMcpAppSize({ hash: resource.hash, meta: resource.meta })
  if (resource.html !== undefined && (typeof resource.html !== 'string' || new TextEncoder().encode(resource.html).byteLength > MCP_APP_HTML_MAX_BYTES)) throw new McpAppsError('invalid', 'MCP App HTML exceeds the size limit')
}

/** Deliberately excludes call id: only new Views in the same provider/server origin share reads. */
export function mcpAppResourceReadKey(app: ToolAppAttachment): string {
  return JSON.stringify([app.binding.node, app.binding.session, app.binding.server, app.binding.account,
    app.binding.configGeneration, app.binding.configFingerprint, app.origin?.providerSessionId, app.resourceUri])
}

/** Bounded LRU + single flight, usable by host and native phone without harness dependencies. */
export class McpAppResourceCache {
  private entries = new Map<string, { value: McpAppResourceSnapshot; bytes: number }>()
  private pending = new Map<string, Promise<McpAppResourceSnapshot>>()
  private bytes = 0
  constructor(private readonly limits = { entries: 32, bytes: 16 * 1024 * 1024, pending: 64 }) {}
  get(key: string): McpAppResourceSnapshot | undefined {
    const entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    return entry?.value
  }
  put(key: string, value: McpAppResourceSnapshot): void {
    validateMcpAppResource(value)
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
    const previous = this.entries.get(key)
    if (previous) { this.entries.delete(key); this.bytes -= previous.bytes }
    if (bytes > this.limits.bytes) return
    this.entries.set(key, { value, bytes }); this.bytes += bytes
    while (this.entries.size > this.limits.entries || this.bytes > this.limits.bytes) {
      const oldest = this.entries.keys().next().value!
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest)
    }
  }
  delete(key: string): void {
    const previous = this.entries.get(key)
    if (previous) { this.entries.delete(key); this.bytes -= previous.bytes }
  }
  load(key: string, read: () => Promise<McpAppResourceSnapshot>): Promise<McpAppResourceSnapshot> {
    const cached = this.get(key)
    return cached ? Promise.resolve(cached) : this.refresh(key, read)
  }
  refresh(key: string, read: () => Promise<McpAppResourceSnapshot>): Promise<McpAppResourceSnapshot> {
    const pending = this.pending.get(key)
    if (pending) return pending
    if (this.pending.size >= this.limits.pending) return Promise.reject(new McpAppsError('denied', 'Too many pending MCP App resource reads'))
    const next = Promise.resolve().then(read).then(value => { this.put(key, value); return value }).finally(() => { this.pending.delete(key) })
    this.pending.set(key, next)
    return next
  }
}
