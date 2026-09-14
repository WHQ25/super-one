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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADHOC_SESSION_ID, sessionZoneDir, zoneRelativePath } from '../media-output-paths'
import { currentCallOwner } from '../mcp/artifact-registry'

export const OWNER_FILE = '.owner'

/** The node a session runs on, or null for a session of this desktop. */
export type ZoneOwner = string | null

/**
 * Record who a session's zone belongs to. The marker is what the reclaim
 * sweep deletes on, so it only ever moves towards more certainty: a node's
 * id is written as given, `local` only where nothing was recorded before
 * (a local session's call can reach a zone a node already claimed — the UI
 * capturing from a device a remote session holds — and must not turn the
 * node's directory into one the sweep will check against this database),
 * and `undefined` — no call running — writes nothing at all.
 */
export function markZoneOwner(sessionId: string, owner: ZoneOwner | undefined): void {
  if (owner === undefined) return
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  try {
    const dir = sessionZoneDir(sessionId)
    mkdirSync(dir, { recursive: true })
    const marker = join(dir, OWNER_FILE)
    if (owner === null && readOwnerFile(marker) !== null) return
    writeFileSync(marker, owner ?? 'local', { mode: 0o600 })
  } catch {
    /* the marker is an optimisation for reclaim, never a precondition for writing */
  }
}

function readOwnerFile(marker: string): string | null {
  try {
    return readFileSync(marker, 'utf8').trim() || null
  } catch {
    return null
  }
}

/**
 * Create `dir` and, when it lies in a session's zone, record `owner` for
 * that session. The one way to create a zone directory: a caller that knows
 * who it is writing for says so here; one that does not know passes
 * `undefined` and leaves the marker as it is.
 */
export function ensureZoneDir(dir: string, owner: ZoneOwner | undefined, mode?: number): string {
  mkdirSync(dir, { recursive: true, ...(mode === undefined ? {} : { mode }) })
  const zone = zoneRelativePath(dir)
  if (zone) markZoneOwner(zone.sessionId, owner)
  return dir
}

/**
 * `ensureZoneDir` for a producer that may be running inside a tool call,
 * where the call scope knows the owner: a Host Action carries its node's
 * connection, a local session's call carries none. Outside any call — the
 * UI capturing from a device a session holds — the owner is unknown, and
 * an unknown owner marks nothing rather than guessing `local`. Code that
 * runs outside a call but knows its connection (a download finalizer, a
 * `will-download` capture, the lazy mirror) passes it to `ensureZoneDir`.
 */
export function ensureArtifactDir(dir: string, mode?: number): string {
  return ensureZoneDir(dir, currentCallOwner(), mode)
}
