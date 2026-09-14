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
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ADHOC_SESSION_ID, sessionZoneDir, syncZoneRoot } from '../media-output-paths'
import { OWNER_FILE } from './zone-owner'
import type { SyncZoneReclaimResult, SyncZoneUsage } from '@superone/shared/environment'

export async function removeSessionZone(sessionId: string): Promise<void> {
  if (!sessionId || sessionId === ADHOC_SESSION_ID) return
  const { getEnvironmentHost } = await import('./environment-host')
  getEnvironmentHost().artifactTransfers?.dropSession(sessionId)
  await rm(sessionZoneDir(sessionId), { recursive: true, force: true })
}

/** Captures taken with no session are kept this long, then pruned. */
export const ADHOC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** A directory touched this recently is in use, whatever else is known about it. */
export const ACTIVE_GRACE_MS = 60 * 60 * 1000

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

export { markZoneOwner } from './zone-owner'

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
function pruneOldFiles(dir: string, cutoff: number, dryRun = false): number {
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
        freed += pruneOldFiles(path, cutoff, dryRun)
        continue
      }
      // A link is removed as a link (never followed), and only when it is old.
      if (st.mtimeMs >= cutoff) continue
      freed += st.size
      if (!dryRun) rmSync(path, { force: true })
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
export async function reclaimSyncZone(
  deps: ZoneReclaimDeps,
  /** Report what would go without touching anything — what Settings shows as reclaimable. */
  opts: { dryRun?: boolean } = {},
): Promise<SyncZoneReclaimResult> {
  const dryRun = opts.dryRun === true
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
      freedBytes += pruneOldFiles(dir, now - ADHOC_MAX_AGE_MS, dryRun)
      continue
    }
    if (deps.hasPendingTransfer(sessionId)) continue
    const idle = now - newestMtime(dir)
    if (idle < ACTIVE_GRACE_MS) continue

    const owner = readOwner(dir)
    let gone: boolean
    if (owner === null) {
      // Ownership has only been recorded since 2026-09, and an unmarked
      // directory may belong to a live *remote* session, which has no row in
      // this database — so the database not naming it is not evidence, and
      // there is nobody to ask instead. Age would only be a TTL, and this
      // sweep deletes on proof, not on a timer. Such a directory is kept.
      gone = false
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
    if (dryRun) {
      removed.push(sessionId)
      continue
    }
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
 * The sweep as the app runs it — at launch, on node connect, and when the
 * person presses "Reclaim Now" in Settings: local sessions from the database,
 * remote ones from their node when that connection is live, transfers from
 * the job table. Failures are swallowed — reclaim is housekeeping and must
 * never keep the app from starting.
 */
export async function sweepSyncZone(): Promise<SyncZoneReclaimResult> {
  return runSyncZoneReclaim()
}

/**
 * The numbers Settings shows: what the zone holds, what is still to be
 * uploaded, and what a sweep would free. Looking never frees anything —
 * the sweep here is a dry run.
 */
export async function syncZoneUsage(): Promise<SyncZoneUsage> {
  const root = syncZoneRoot()
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    /* no zone yet */
  }
  let totalBytes = 0
  let adhocBytes = 0
  let sessionCount = 0
  for (const name of entries) {
    const dir = join(root, name)
    if (!linkSafeStat(dir)?.isDirectory) continue
    const bytes = sizeOf(dir)
    totalBytes += bytes
    if (name === ADHOC_SESSION_ID) adhocBytes += bytes
    else sessionCount++
  }
  const pendingBytes = await pendingUploadBytes()
  const dry = await runSyncZoneReclaim({ dryRun: true })
  return {
    root,
    totalBytes,
    sessionCount,
    adhocBytes,
    pendingBytes,
    reclaimable: { sessions: dry.removed.length, bytes: dry.freedBytes },
    failedHandoffs: await failedHandoffUsage(),
  }
}

/**
 * Files complete on disk that never reached the job table. Counted separately
 * from `pendingBytes`, which is about rows a worker will get to — these have
 * no row, so nothing is coming for them until something retries.
 */
async function failedHandoffUsage(): Promise<{ files: number; bytes: number; lastError: string | null }> {
  try {
    const { failedHandoffs } = await import('./pending-handoffs')
    const entries = failedHandoffs()
    // One file, one count — and never double-counted against a job row that
    // may exist for the same path from an earlier attempt.
    const seen = new Set<string>()
    let bytes = 0
    let files = 0
    for (const entry of entries) {
      const real = safeRealpath(entry.localPath)
      if (seen.has(real)) continue
      seen.add(real)
      const st = linkSafeStat(entry.localPath)
      if (!st?.isFile) continue
      files += 1
      bytes += st.size
    }
    return { files, bytes, lastError: entries.at(-1)?.lastError ?? null }
  } catch {
    return { files: 0, bytes: 0, lastError: null }
  }
}

async function pendingUploadBytes(): Promise<number> {
  try {
    const { listUploadingArtifactTransfers } = await import('../db-artifact-transfers')
    // One file, one count: a retry leaves several rows for the same path, and
    // only bytes not yet on the node count as still to be uploaded.
    const seen = new Set<string>()
    let bytes = 0
    for (const job of listUploadingArtifactTransfers()) {
      const real = safeRealpath(job.localPath)
      if (seen.has(real)) continue
      const st = linkSafeStat(job.localPath)
      if (st?.isFile) {
        seen.add(real)
        bytes += st.size
      }
    }
    return bytes
  } catch {
    return 0
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

async function runSyncZoneReclaim(opts: { dryRun?: boolean } = {}): Promise<SyncZoneReclaimResult> {
  try {
    const [{ sessionExists }, { listArtifactTransfersForSession }, { getEnvironmentHost }] = await Promise.all([
      import('../db-sessions'),
      import('../db-artifact-transfers'),
      import('./environment-host'),
    ])
    const result = await reclaimSyncZone({
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
          // `failed` is terminal — no retry is scheduled — so it is not an
          // upload still queued, and must not pin a dead directory forever.
          return listArtifactTransfersForSession(sessionId).some((job) => job.state !== 'failed')
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
    }, opts)
    // The directory is gone; its terminal job rows go with it.
    if (!opts.dryRun) for (const sessionId of result.removed) getEnvironmentHost().artifactTransfers?.dropSession(sessionId)
    return result
  } catch {
    return { removed: [], freedBytes: 0 }
  }
}

/**
 * One sweep at a time, and not for every nudge. The sweep is asked to run
 * at launch and whenever a node connects — a node that was offline at
 * launch and reconnects later is the case the launch-only sweep missed,
 * because an unreachable node means "keep" and nobody asked again. A
 * reconnect raises several status changes in a row, so requests inside the
 * debounce window collapse into one run; a request that arrives while a
 * sweep is running may carry new evidence and gets one more run after it.
 */
export function createReclaimScheduler(
  run: () => Promise<unknown>,
  opts: { debounceMs?: number } = {},
): { request(): void; dispose(): void } {
  const debounceMs = opts.debounceMs ?? 5_000
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let disposed = false
  const start = (): void => {
    timer = null
    if (disposed) return
    if (running) { again = true; return }
    running = true
    void run().catch(() => undefined).finally(() => {
      running = false
      if (again && !disposed) { again = false; schedule() }
    })
  }
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(start, debounceMs)
    timer.unref?.()
  }
  return {
    request: () => { if (!disposed) schedule() },
    dispose: () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
