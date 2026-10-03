import { McpAppsError } from '@superone/shared/mcp-apps'
import type { McpAppsRequest } from './mcp-apps'

const loaded = new WeakMap<object, Map<string, Promise<void>>>()
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Read the provider's ancestry, including after restart; a saved View cannot authorize an unrelated thread. */
export async function ensureCodexMcpAppThread(request: McpAppsRequest, parentThreadId: string, appThreadId: string, connection: object = request): Promise<void> {
  if (appThreadId === parentThreadId) return
  let cache = loaded.get(connection)
  if (!cache) { cache = new Map(); loaded.set(connection, cache) }
  const key = JSON.stringify([parentThreadId, appThreadId])
  const existing = cache.get(key)
  if (existing) return existing
  const load = async () => {
    const seen = new Set<string>()
    let threadId = appThreadId
    while (threadId !== parentThreadId) {
      if (seen.has(threadId) || seen.size >= 32) throw new McpAppsError('inactive', 'MCP App child thread ancestry is invalid')
      seen.add(threadId)
      const thread = record((await request('thread/read', { threadId, includeTurns: false })).thread)
      const spawn = record(record(record(thread.source).subAgent).thread_spawn)
      const parent = spawn.parent_thread_id ?? thread.forkedFromId ?? thread.forked_from_id
      if (typeof parent !== 'string' || !parent) throw new McpAppsError('inactive', 'MCP App thread does not belong to this session')
      threadId = parent
    }
    await request('thread/resume', { threadId: appThreadId })
  }
  const pending = load().catch(error => { cache!.delete(key); throw error })
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(key, pending)
  return pending
}
