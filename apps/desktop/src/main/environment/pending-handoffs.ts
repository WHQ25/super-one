/**
 * Files that are complete, are the only copy, and could not be written onto
 * the transfer job table (`docs/design/session-sync-zone.md` §4.1).
 *
 * `defer` is purely local — `statSync`, a SQLite insert, a worker wake — so it
 * fails for local reasons: the database is busy, the file moved, there is no
 * transfer service for that connection yet. A node being unreachable does NOT
 * land here; that is what the worker's backoff over persisted jobs is for.
 *
 * Both handoff paths reach this table, and that is the point of it existing:
 *
 * - **Foreground.** `syncHostActionOutputs` either pushes the file inside the
 *   claim budget or files a job for it. When *that* enqueue throws, the Host
 *   Action executor used to release the claim in its `finally` regardless —
 *   the file then had no job row, no node copy and no protection, and the next
 *   directory mirror pruned it.
 * - **Background.** A page-started download's `queueDownloadUpload` retries a
 *   transient failure and eventually gives up.
 *
 * Two rules make this safe, and both were learned from getting them wrong:
 *
 * - **The entry carries the claim's holder.** Recovery does not re-adopt:
 *   `adoptWriteClaim` only accepts a claim still held by `writer`, so a second
 *   adopt of a file the queue already took returns false and the eventual
 *   release silently does nothing. Whoever recorded the failure stays
 *   responsible, and the retry releases as *that* holder.
 * - **The original `transferId` is kept.** A retry that invents a new id makes
 *   the node meet a second transfer for the same file instead of resuming the
 *   partial one it already has.
 *
 * This table is in memory. A desktop that quits with entries in it loses the
 * protection, and the file becomes an ordinary unreferenced zone file — see
 * §9; there is no crash-recovery journal, and this file does not pretend
 * otherwise.
 */
import { canonicalClaimPath, releaseWriteClaim, type ClaimHolder } from './active-writes'
import log from '../logger'

export interface HandoffJob {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  transferId: string
}

export interface PendingHandoff extends HandoffJob {
  /** Who holds the write claim, so recovery can release it as the same holder. */
  holder: ClaimHolder
  attempts: number
  lastError: string
  /** Size at the time of the failure, for the Storage figure. Zero when it could not be read. */
  bytes: number
}

/** How the caller files a job; returns normally on success and throws on failure. */
export type EnqueueJob = (job: HandoffJob) => void

const pending = new Map<string, PendingHandoff>()

function keyFor(connectionId: string, sessionId: string, localPath: string): string {
  return `${connectionId}\t${sessionId}\t${canonicalClaimPath(localPath)}`
}

/**
 * Remember a handoff that did not persist, so the file stays protected and
 * something can try again. Re-recording the same file updates it in place
 * rather than queueing a second attempt at one path.
 */
export function recordFailedHandoff(entry: Omit<PendingHandoff, 'attempts'> & { attempts?: number }): void {
  const key = keyFor(entry.connectionId, entry.sessionId, entry.localPath)
  const previous = pending.get(key)
  pending.set(key, {
    ...entry,
    attempts: (previous?.attempts ?? 0) + (entry.attempts ?? 1),
  })
  log.warn(
    '[artifact-handoff] %s could not be queued (%s); the desktop copy stays protected until this is retried',
    entry.relativePath,
    entry.lastError,
  )
}

/** Is this file waiting on a retry? A holder that sees `true` must not release it. */
export function hasFailedHandoff(sessionId: string, localPath: string, connectionId?: string): boolean {
  if (connectionId) return pending.has(keyFor(connectionId, sessionId, localPath))
  const suffix = `\t${sessionId}\t${canonicalClaimPath(localPath)}`
  for (const key of pending.keys()) if (key.endsWith(suffix)) return true
  return false
}

/**
 * Try the failed handoffs again, releasing each claim only once its job row
 * exists. Called when a connection's transfer worker starts or resumes, and
 * from the Settings retry action.
 *
 * A connection filter is honoured because a worker only ever speaks for its
 * own connection; entries for others are left for theirs.
 */
export function retryFailedHandoffs(enqueue: EnqueueJob, connectionId?: string): { retried: number; recovered: number } {
  let retried = 0
  let recovered = 0
  for (const [key, entry] of [...pending]) {
    if (connectionId && entry.connectionId !== connectionId) continue
    retried += 1
    try {
      enqueue({
        connectionId: entry.connectionId,
        sessionId: entry.sessionId,
        localPath: entry.localPath,
        relativePath: entry.relativePath,
        // Same id: the node resumes the partial upload rather than meeting a second one.
        transferId: entry.transferId,
      })
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err)
      pending.set(key, { ...entry, attempts: entry.attempts + 1, lastError })
      continue
    }
    pending.delete(key)
    // Released as the holder that recorded the failure. Re-adopting would fail:
    // the claim is no longer held by `writer`.
    releaseWriteClaim(entry.sessionId, entry.localPath, entry.holder)
    recovered += 1
  }
  return { retried, recovered }
}

/**
 * The session is gone (§7): there is nothing left to hand to the node, so the
 * entries and the claims they were protecting both go.
 */
export function dropSessionHandoffs(sessionId: string): void {
  for (const [key, entry] of [...pending]) {
    if (entry.sessionId !== sessionId) continue
    pending.delete(key)
    releaseWriteClaim(entry.sessionId, entry.localPath, entry.holder)
  }
}

/** Everything still waiting, for the Storage figure and for tests. */
export function failedHandoffs(sessionId?: string): PendingHandoff[] {
  const all = [...pending.values()]
  return sessionId ? all.filter((e) => e.sessionId === sessionId) : all
}

/** Tests only. */
export function resetPendingHandoffs(): void {
  pending.clear()
}
