import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MCP_APP_HTML_MAX_BYTES, McpAppsError } from '@superone/shared/mcp-apps'
import { McpAppResourceCache, validateMcpAppResource, type McpAppResource, type McpAppResourceSnapshot, type McpAppResourceStore } from '@superone/shared/mcp-app-resource'

/** Immutable history blobs are not LRU-evicted. Only their bounded read cache is evictable. */
export function createMcpAppResourceStore(directory: string): McpAppResourceStore {
  const cache = new McpAppResourceCache()
  const digest = (html: string) => createHash('sha256').update(html).digest('hex')
  const path = (hash: string) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new McpAppsError('invalid', 'Invalid saved MCP App resource hash')
    return join(directory, `${hash}.html`)
  }
  return {
    put(snapshot: McpAppResourceSnapshot): McpAppResource {
      validateMcpAppResource(snapshot)
      const hash = digest(snapshot.html), file = path(hash)
      if (!existsSync(file) || statSync(file).size > MCP_APP_HTML_MAX_BYTES || digest(readFileSync(file, 'utf8')) !== hash) {
        mkdirSync(directory, { recursive: true })
        const temporary = join(directory, `${hash}.${randomUUID()}.tmp`)
        try { writeFileSync(temporary, snapshot.html, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(temporary, file) }
        finally { rmSync(temporary, { force: true }) }
      }
      utimesSync(file, new Date(), new Date()) // Protect a new in-flight reference to an old shared blob.
      cache.put(hash, { ...snapshot, hash })
      return { hash, meta: snapshot.meta }
    },
    hydrate(resource: McpAppResource): McpAppResourceSnapshot {
      validateMcpAppResource(resource)
      if (resource.html !== undefined) return resource as McpAppResourceSnapshot
      const file = path(resource.hash)
      let html = cache.get(resource.hash)?.html
      if (html === undefined) {
        try { if (statSync(file).size > MCP_APP_HTML_MAX_BYTES) throw new Error('Oversized blob'); html = readFileSync(file, 'utf8') } catch { throw new McpAppsError('invalid', 'Saved MCP App HTML is unavailable') }
        validateMcpAppResource({ ...resource, html })
        if (digest(html) !== resource.hash) throw new McpAppsError('invalid', 'Saved MCP App HTML hash does not match')
        cache.put(resource.hash, { ...resource, html })
      }
      return { ...resource, html }
    },
    collect(references: Iterable<string>, graceMs = 5 * 60_000): number {
      const retained = new Set(references)
      let files: string[]
      try { files = readdirSync(directory) } catch { return 0 }
      let removed = 0
      for (const file of files) {
        const match = /^([a-f0-9]{64})\.html$/.exec(file)
        if (!match || retained.has(match[1]!)) continue
        const blob = path(match[1]!)
        try {
          if (Date.now() - statSync(blob).mtimeMs < graceMs) continue
          rmSync(blob); cache.delete(match[1]!); removed++
        } catch { /* A concurrent write/removal is retried on a later sweep. */ }
      }
      return removed
    },
  }
}
