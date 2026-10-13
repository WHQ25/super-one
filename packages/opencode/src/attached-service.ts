import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { OpenCodeServerHandle } from './server'

const locations = new Map<string, { sessionId: string; references: number }>()

/** Native MCP configuration belongs to an endpoint/location, not a session. */
export function claimAttachedOpenCodeLocation(server: OpenCodeServerHandle, cwd: string, sessionId: string): OpenCodeServerHandle {
  let directory = resolve(cwd)
  try { directory = realpathSync(directory) } catch { /* Native location validation follows. */ }
  const key = JSON.stringify([new URL(server.url).href.replace(/\/$/, ''), directory])
  let entry = locations.get(key)
  if (entry && entry.sessionId !== sessionId)
    throw new Error('Attached OpenCode V2 endpoints require a dedicated location for each SuperOne session')
  if (!entry) { entry = { sessionId, references: 0 }; locations.set(key, entry) }
  entry.references++
  let closed = false
  return { ...server, close: async () => {
    if (closed) return
    closed = true
    try { await server.close() } finally { if (--entry.references === 0) locations.delete(key) }
  } }
}
