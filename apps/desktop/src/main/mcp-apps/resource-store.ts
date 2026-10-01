import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createMcpAppResourceStore } from '@superone/runtime/mcp-apps/resource-store'
import { createMcpAppResourceGc } from '@superone/runtime/mcp-apps/resource-gc'
import { mcpAppResourceHashes } from '@superone/shared/mcp-apps-state'
import type { McpAppResourceStore } from '@superone/shared/mcp-app-resource'
import { getDb } from '../database'

let store: McpAppResourceStore | undefined
let gc: ReturnType<typeof createMcpAppResourceGc> | undefined
const directory = () => join(app.getPath('userData'), 'mcp-app-resources')
function references(): Set<string> {
  const hashes = new Set<string>()
  const rows = getDb().prepare(`SELECT content_json, metadata_json FROM chat_messages WHERE content_json LIKE '%"appInstanceId"%' OR metadata_json LIKE '%"appInstanceId"%'`).iterate() as Iterable<{ content_json: string; metadata_json: string | null }>
  for (const row of rows) {
    const content = JSON.parse(row.content_json)
    const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined
    for (const hash of mcpAppResourceHashes([{ id: '', content: Array.isArray(content) ? content : content.content, metadata }])) hashes.add(hash)
  }
  return hashes
}
export function getMcpAppResourceStore(): McpAppResourceStore {
  if (!store) {
    store = createMcpAppResourceStore(directory())
    gc = createMcpAppResourceGc(store, references)
    gc.schedule()
  }
  return store
}
/** Called after cascading session/project removal; the settled sweep respects new writes. */
export function scheduleMcpAppResourceGc(): void {
  if (!store && !existsSync(directory())) return
  getMcpAppResourceStore(); gc?.schedule()
}
