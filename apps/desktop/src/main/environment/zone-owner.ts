/**
 * Who a session's zone directory belongs to, recorded where the directory is
 * created (`docs/design/session-sync-zone.md` §7).
 *
 * The reclaim sweep only deletes a directory whose owner it can ask — this
 * database for a local session, the node for a remote one — and keeps an
 * unmarked directory forever, because "nobody marked it" is not evidence of
 * anything. So the marker's coverage is the sweep's reach, and every entry
 * that creates a zone directory writes it: producers, downloads, the lazy
 * mirror. Written into the directory itself rather than a table, so it
 * travels with the thing being reclaimed and cannot go stale separately.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADHOC_SESSION_ID, sessionZoneDir, zoneRelativePath } from '../media-output-paths'
import { currentHostActionConnection } from '../mcp/artifact-registry'

export const OWNER_FILE = '.owner'

/** The node a session runs on, or null for a session of this desktop. */
export type ZoneOwner = string | null

export function markZoneOwner(sessionId: string, owner: ZoneOwner): void {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  try {
    const dir = sessionZoneDir(sessionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, OWNER_FILE), owner ?? 'local', { mode: 0o600 })
  } catch {
    /* the marker is an optimisation for reclaim, never a precondition for writing */
  }
}

/**
 * Create `dir` and, when it lies in a session's zone, record `owner` for
 * that session. The one way to create a zone directory: a caller that knows
 * who it is writing for says so here.
 */
export function ensureZoneDir(dir: string, owner: ZoneOwner, mode?: number): string {
  mkdirSync(dir, { recursive: true, ...(mode === undefined ? {} : { mode }) })
  const zone = zoneRelativePath(dir)
  if (zone) markZoneOwner(zone.sessionId, owner)
  return dir
}

/**
 * `ensureZoneDir` for a producer running inside a tool call, where the call
 * scope knows the owner: a Host Action carries its node's connection, and a
 * local session's call opens no scope at all. Not for code that runs outside
 * a tool call — a download finalizer, a `will-download` capture, the lazy
 * mirror — which knows its connection explicitly and passes it to
 * `ensureZoneDir`; "no scope" there would misfile a remote directory as local.
 */
export function ensureArtifactDir(dir: string, mode?: number): string {
  return ensureZoneDir(dir, currentHostActionConnection(), mode)
}
