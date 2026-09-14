/**
 * Session deletion reclaims its sync zone (`docs/design/session-sync-zone.md` §7).
 *
 * Two sides, both routed here so neither is forgotten:
 *  - the desktop copy under `<userData>/sync/<sessionId>` is removed;
 *  - any in-flight or queued transfer job for the session is cancelled.
 * The node's own copy is dropped by the node when the session is removed there
 * (`session.remove` → `artifact.delete`), or the whole session directory when
 * the desktop calls `artifactDelete` in `EnvironmentHost.removeSession`.
 *
 * `adhoc` holds captures taken with no session and is never auto-deleted.
 */
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ADHOC_SESSION_ID, sessionZoneDir, syncZoneRoot } from '../media-output-paths'

export async function removeSessionZone(sessionId: string): Promise<void> {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  const { getEnvironmentHost } = await import('./environment-host')
  getEnvironmentHost().artifactTransfers?.dropSession(sessionId)
  await rm(sessionZoneDir(sessionId), { recursive: true, force: true })
}

/** Captures taken with no session are kept this long, then pruned. */
export const ADHOC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/**
 * How long a directory with no ownership marker is left alone. Zones written
 * before ownership was recorded could belong to a live *remote* session, which
 * has no row in this database — so "the database does not know it" is not
 * evidence there, and only a long silence is.
 */
export const UNMARKED_GRACE_MS = 7 * 24 * 60 * 60 * 1000
/** A directory touched this recently is in use, whatever else is known about it. */
export const ACTIVE_GRACE_MS = 60 * 60 * 1000
const OWNER_FILE = '.owner'

export interface ZoneReclaimDeps {
  now?: () => number
  /** Does this desktop still have the session? Only meaningful for a local one. */
  hasLocalSession: (sessionId: string) => boolean
  /** Is an upload still queued for it? Then its files are not ours to drop. */
  hasPendingTransfer: (sessionId: string) => boolean
  /**
   * Does the node still have it? `'unknown'` when the connection is not live —
   * and then the directory is kept, because an unreachable node is not a
   * deleted session.
   */
  remoteSessionExists?: (connectionId: string, sessionId: string) => Promise<boolean | 'unknown'>
}

/**
 * Record who a zone directory belongs to, so the sweep can ask the right side
 * whether the session still exists. Written into the directory itself rather
 * than a table: the directory is the thing being reclaimed, and a marker that
 * travels with it cannot go stale separately.
 */
export function markZoneOwner(sessionId: string, connectionId: string | null): void {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  try {
    const dir = sessionZoneDir(sessionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, OWNER_FILE), connectionId ?? 'local', { mode: 0o600 })
  } catch {
    /* the marker is an optimisation for reclaim, never a precondition for writing */
  }
}

function readOwner(dir: string): string | null {
  try {
    const value = readFileSync(join(dir, OWNER_FILE), 'utf8').trim()
    return value || null
  } catch {
    return null
  }
}

/**
 * Every walk here uses `lstat`, never `stat`. The sweep deletes things, and a
 * symlink is the one way a delete could land outside the zone: a link the
 * agent (or anything else with write access) drops in would otherwise be
 * followed into someone else's files. A link is never descended into; it is
 * only ever removed as the link it is.
 */
function linkSafeStat(path: string): { isDirectory: boolean; isFile: boolean; size: number; mtimeMs: number } | null {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return { isDirectory: false, isFile: false, size: 0, mtimeMs: st.mtimeMs }
    return { isDirectory: st.isDirectory(), isFile: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

function sizeOf(path: string): number {
  const st = linkSafeStat(path)
  if (!st) return 0
  if (st.isFile) return st.size
  if (!st.isDirectory) return 0
  try {
    return readdirSync(path).reduce((total, name) => total + sizeOf(join(path, name)), 0)
  } catch {
    return 0
  }
}

function newestMtime(path: string): number {
  const st = linkSafeStat(path)
  if (!st) return 0
  if (!st.isDirectory) return st.mtimeMs
  let newest = st.mtimeMs
  try {
    for (const name of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, name)))
  } catch {
    /* unreadable: what we have is the answer */
  }
  return newest
}

/** Delete files under `dir` older than the cutoff, leaving the directory itself. */
function pruneOldFiles(dir: string, cutoff: number): number {
  let freed = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    const path = join(dir, name)
    const st = linkSafeStat(path)
    if (!st) continue
    try {
      if (st.isDirectory) {
        freed += pruneOldFiles(path, cutoff)
        continue
      }
      // A link is removed as a link (never followed), and only when it is old.
      if (st.mtimeMs >= cutoff) continue
      freed += st.size
      rmSync(path, { force: true })
    } catch {
      /* raced with something else; the next sweep will see it */
    }
  }
  return freed
}

/**
 * Reclaim what the zone no longer needs (`docs/design/session-sync-zone.md`
 * §7). Deliberately evidence-based rather than quota-based: a session's
 * artifacts are named by its transcript, so the only safe thing to delete is a
 * directory whose session is *known* to be gone, plus `adhoc` captures nobody
 * claimed. Everything ambiguous — an unreachable node, a queued transfer, a
 * directory in use — is kept.
 */
export async function reclaimSyncZone(deps: ZoneReclaimDeps): Promise<{ removed: string[]; freedBytes: number }> {
  const now = (deps.now ?? Date.now)()
  const root = syncZoneRoot()
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return { removed: [], freedBytes: 0 }
  }

  const removed: string[] = []
  let freedBytes = 0
  for (const sessionId of entries) {
    const dir = join(root, sessionId)
    // A session zone is a real directory. A link here names something outside
    // the zone, and removing what it points at is never ours to do.
    const dirStat = linkSafeStat(dir)
    if (!dirStat?.isDirectory) continue
    if (sessionId === ADHOC_SESSION_ID) {
      freedBytes += pruneOldFiles(dir, now - ADHOC_MAX_AGE_MS)
      continue
    }
    if (deps.hasPendingTransfer(sessionId)) continue
    const idle = now - newestMtime(dir)
    if (idle < ACTIVE_GRACE_MS) continue

    const owner = readOwner(dir)
    let gone: boolean
    if (owner === null) {
      // Ownership has only been recorded since 2026-09; an older directory may
      // belong to a live local session (the database still names it) or to a
      // live remote one (it does not, and cannot). So the database gets the
      // first word, and only then does a week of silence count as death.
      gone = !deps.hasLocalSession(sessionId) && idle >= UNMARKED_GRACE_MS
    } else if (owner === 'local') {
      gone = !deps.hasLocalSession(sessionId)
    } else {
      const answer = await deps.remoteSessionExists?.(owner, sessionId) ?? 'unknown'
      gone = answer === false
    }
    if (!gone) continue
    // Asking the node was an await; the session may have written since, or the
    // marker may have changed. Re-check both before deleting anything.
    if (now - newestMtime(dir) < ACTIVE_GRACE_MS) continue
    if (readOwner(dir) !== owner) continue
    if (deps.hasPendingTransfer(sessionId)) continue

    freedBytes += sizeOf(dir)
    try {
      rmSync(dir, { recursive: true, force: true })
      removed.push(sessionId)
    } catch {
      freedBytes -= sizeOf(dir)
    }
  }
  return { removed, freedBytes }
}

/**
 * The sweep as the app runs it: local sessions from the database, remote ones
 * from their node when that connection is live, transfers from the job table.
 * Failures are swallowed — reclaim is housekeeping and must never keep the app
 * from starting.
 */
export async function reclaimSyncZoneOnStartup(): Promise<{ removed: string[]; freedBytes: number }> {
  try {
    const [{ sessionExists }, { listArtifactTransfersForSession }, { getEnvironmentHost }] = await Promise.all([
      import('../db-sessions'),
      import('../db-artifact-transfers'),
      import('./environment-host'),
    ])
    return await reclaimSyncZone({
      hasLocalSession: (sessionId) => {
        try {
          return sessionExists(sessionId)
        } catch {
          // Cannot tell: treat as present, because deleting a live session's
          // artifacts is far worse than keeping a dead one's.
          return true
        }
      },
      hasPendingTransfer: (sessionId) => {
        try {
          return listArtifactTransfersForSession(sessionId).length > 0
        } catch {
          return true
        }
      },
      remoteSessionExists: async (connectionId, sessionId) => {
        try {
          return (await getEnvironmentHost().getSession(connectionId, sessionId)) ? true : false
        } catch {
          return 'unknown'
        }
      },
    })
  } catch {
    return { removed: [], freedBytes: 0 }
  }
}
