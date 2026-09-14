/**
 * One transfer instance per zone file, owning both its protection and its
 * delivery (`docs/design/session-sync-zone.md` §4.1).
 *
 * The invariant this file exists to hold:
 *
 * > At any moment a given file version corresponds to **one identifiable
 * > transfer instance**. Protection begins before the first node RPC and lasts
 * > until that instance's delivery ends. Release, retry and cancellation all
 * > verify the instance and the session are still the ones they were for.
 *
 * That is stricter than "whoever holds it releases it", and the difference is
 * where the last several defects lived. Three of them:
 *
 * - Protection that began after the enqueue failed left the whole eager push —
 *   a `stat`, a hash, an upload, every one an await — with the file held by
 *   nobody. A concurrent directory mirror deleted it mid-flight.
 * - A second Host Action checking "is there a task?" *before* an await and
 *   acting on the answer after it started a second delivery with a second
 *   transfer id. Both uploaded; the later one put stale bytes back over the
 *   node's newer file, and no receipt dedup can catch two different ids.
 * - A role label (`push`) is not an identity. Two concurrent actions both
 *   called themselves that, and cancelling either released the file the other
 *   was still delivering.
 *
 * So an instance is acquired **synchronously**, before anything is awaited, and
 * it holds the claim under a token minted for it alone. A second caller for the
 * same path does not create one and does not take the claim — it is told the
 * file already has an owner and reports it deferred. Delivery ends exactly
 * once: the eager push landed (`deliverHandoff`), a job row exists
 * (`enqueueHandoff` succeeding), or the owner gave up without doing either
 * (`abandonHandoff`).
 *
 * `defer` itself is purely local — `statSync`, a SQLite insert, a worker wake —
 * so it fails for local reasons. A node that is merely unreachable never
 * reaches the retry ladder here; persisted jobs and the worker's backoff cover
 * that.
 *
 * This table is in memory. A desktop that quits with instances in it loses
 * their protection — see §9; there is no crash-recovery journal, and this file
 * does not pretend otherwise.
 */
import { randomUUID } from 'node:crypto'
import { releaseWriteClaim, takeSealedClaim, canonicalClaimPath } from './active-writes'
import log from '../logger'

export interface HandoffJob {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  transferId: string
}

/**
 * Files the job. Returns normally on success, throws on failure.
 *
 * Synchronous by contract, and that is load-bearing rather than stylistic: the
 * check that stops work for a deleted session has to sit immediately before the
 * call with nothing in between. An enqueue that awaits internally would have
 * been entered already by the time anyone could refuse it, so a caller with an
 * async dependency resolves it BEFORE acquiring the instance.
 */
export type EnqueueJob = (job: HandoffJob) => void

/**
 * `pushing` — its owner is uploading it inside a claim budget.
 * `enqueueing` / `failed` — it is becoming a transfer job, or the last attempt threw.
 * `queued` — a persisted job owns the delivery; this instance only names it.
 */
export type HandoffState = 'pushing' | 'enqueueing' | 'failed' | 'queued'

export interface Handoff {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  /** One id for the file's whole delivery, so the node resumes rather than meeting a second transfer. */
  transferId: string
  /** Minted for this instance alone; the claim is released only under it. */
  token: string
  state: HandoffState
  holdsClaim: boolean
  attempts: number
  lastError: string | null
  bytes: number
  enqueue: EnqueueJob | null
  cancelRetry: (() => void) | null
  /**
   * Callers that joined this delivery and were told the file is on its way.
   * The owner giving up must not silently drop a promise they are holding.
   */
  waiters: number
}

/**
 * Finds a persisted transfer job that still owes this file's bytes.
 *
 * Set by the transfer service, so this module keeps no database dependency.
 * Without it a path whose job row already exists looks unowned, and the next
 * Host Action starts a second delivery of it under a second transfer id — two
 * uploads the node cannot dedupe, the later of which puts stale bytes back
 * over whatever the agent did in between.
 */
export type PendingJobLookup = (sessionId: string, localPath: string) => { transferId: string } | null

let findPendingJob: PendingJobLookup | null = null

export function setPendingJobLookup(lookup: PendingJobLookup | null): void {
  findPendingJob = lookup
}

/** Delays before each retry. Short: the file is unprotected work in progress. */
const RETRY_DELAYS_MS = [100, 500, 2000, 5000]

const handoffs = new Map<string, Handoff>()
/**
 * Sessions that have been deleted. A session id is never reused, so this is a
 * tombstone rather than a counter — and it has to outlive the instances,
 * because the case it exists for is a handoff *arriving* after the delete: a
 * caller that awaited something first and came back to a session that is gone.
 */
const dropped = new Set<string>()

function keyFor(connectionId: string, sessionId: string, localPath: string): string {
  return `${connectionId}\t${sessionId}\t${canonicalClaimPath(localPath)}`
}

/**
 * Take ownership of a file's delivery, or report who already has it.
 *
 * Synchronous to its last line, the claim included: everything after this
 * returns may await, and the file has to be held before any of it. `mine` is
 * false when another instance already owns the path — that caller must not
 * upload, must not enqueue, and must not touch the claim.
 *
 * Returns null when the session has been deleted.
 */
export function acquireHandoff(input: {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  bytes: number
}): { handoff: Handoff; mine: boolean } | null {
  if (dropped.has(input.sessionId)) return null
  const key = keyFor(input.connectionId, input.sessionId, input.localPath)
  const existing = handoffs.get(key)
  if (existing) {
    existing.waiters += 1
    return { handoff: existing, mine: false }
  }

  // A job row already owns this file's delivery. It survives this process, so
  // there is no in-memory instance to find — but starting a second delivery
  // beside it is exactly the two-uploads-one-file failure, and the row's own
  // upload would later overwrite whatever the second one delivered.
  const queued = findPendingJob?.(input.sessionId, input.localPath)
  if (queued) {
    return {
      handoff: {
        ...input,
        transferId: queued.transferId,
        token: '',
        state: 'queued',
        holdsClaim: false,
        attempts: 0,
        lastError: null,
        enqueue: null,
        cancelRetry: null,
        waiters: 0,
      },
      mine: false,
    }
  }

  const token = randomUUID()
  const handoff: Handoff = {
    connectionId: input.connectionId,
    sessionId: input.sessionId,
    localPath: input.localPath,
    relativePath: input.relativePath,
    transferId: randomUUID(),
    token,
    state: 'pushing',
    // Taken here: from this line the mirror will not delete or overwrite the
    // file, whether or not its producer ever claimed a path.
    holdsClaim: takeSealedClaim(input.sessionId, input.localPath, token),
    attempts: 0,
    lastError: null,
    bytes: input.bytes,
    enqueue: null,
    cancelRetry: null,
    waiters: 0,
  }
  handoffs.set(key, handoff)
  return { handoff, mine: true }
}

/** Delivery is complete — the bytes are on the node, or it already had them. */
export function deliverHandoff(handoff: Handoff): void {
  settle(handoff)
}

/**
 * The eager push is not happening: hand the file to a transfer job instead,
 * protected until a row exists. Retries a transient failure and keeps the
 * instance when it runs out, because pinning a path is a smaller failure than
 * losing the only complete copy.
 */
export function enqueueHandoff(handoff: Handoff, enqueue: EnqueueJob): void {
  if (handoffs.get(keyFor(handoff.connectionId, handoff.sessionId, handoff.localPath)) !== handoff) return
  handoff.state = 'enqueueing'
  handoff.enqueue = enqueue
  attempt(handoff)
}

/**
 * The owner is giving up without delivering or enqueueing — cancelled, or the
 * action threw. Nothing downstream will carry this file, so holding the claim
 * would pin its path for the life of the process.
 *
 * A no-op once the instance has moved on: an action that already handed the
 * file to a job must not undo that on its way out.
 */
export function abandonHandoff(handoff: Handoff, fallbackEnqueue?: EnqueueJob): void {
  if (handoff.state !== 'pushing') return
  // Someone else was told this file is on its way. Dropping it now would leave
  // them waiting on a node path that never appears and is never reported.
  if (handoff.waiters > 0 && fallbackEnqueue) {
    enqueueHandoff(handoff, fallbackEnqueue)
    return
  }
  settle(handoff)
}

/** A joiner is no longer waiting — its own call was cancelled or finished. */
export function leaveHandoff(handoff: Handoff): void {
  if (handoff.waiters > 0) handoff.waiters -= 1
}

function settle(handoff: Handoff): void {
  const key = keyFor(handoff.connectionId, handoff.sessionId, handoff.localPath)
  if (handoffs.get(key) !== handoff) return
  handoff.cancelRetry?.()
  handoffs.delete(key)
  // Under this instance's own token: a release naming a role could be satisfied
  // by a different caller wearing the same label.
  if (handoff.holdsClaim) releaseWriteClaim(handoff.sessionId, handoff.localPath, handoff.token)
}

function attempt(handoff: Handoff): void {
  const key = keyFor(handoff.connectionId, handoff.sessionId, handoff.localPath)
  if (dropped.has(handoff.sessionId) || handoffs.get(key) !== handoff || !handoff.enqueue) return
  handoff.attempts += 1
  try {
    handoff.enqueue({
      connectionId: handoff.connectionId,
      sessionId: handoff.sessionId,
      localPath: handoff.localPath,
      relativePath: handoff.relativePath,
      transferId: handoff.transferId,
    })
  } catch (err) {
    handoff.state = 'failed'
    handoff.lastError = err instanceof Error ? err.message : String(err)
    scheduleRetry(handoff)
    return
  }
  // The row exists: the job protects the file from here on.
  settle(handoff)
}

function scheduleRetry(handoff: Handoff): void {
  const delay = RETRY_DELAYS_MS[handoff.attempts - 1]
  if (delay === undefined) {
    log.warn(
      '[artifact-handoff] %s could not be queued after %d attempts (%s); the desktop copy stays protected until a retry succeeds',
      handoff.relativePath,
      handoff.attempts,
      handoff.lastError,
    )
    return
  }
  const timer = setTimeout(() => {
    handoff.cancelRetry = null
    attempt(handoff)
  }, delay)
  handoff.cancelRetry = () => clearTimeout(timer)
}

/**
 * Try the failed instances again, releasing each claim only once its row
 * exists. Called when a connection's transfer worker starts or resumes, and
 * from the Settings retry action.
 */
export function retryFailedHandoffs(connectionId?: string): { retried: number } {
  let retried = 0
  for (const handoff of [...handoffs.values()]) {
    if (connectionId && handoff.connectionId !== connectionId) continue
    if (handoff.state !== 'failed') continue
    handoff.cancelRetry?.()
    handoff.cancelRetry = null
    // A fresh ladder: this is a new reason to believe it will work.
    handoff.attempts = 0
    retried += 1
    attempt(handoff)
  }
  return { retried }
}

/**
 * The session is gone (§7): nothing is owed to the node any more. Cancels
 * retries in flight, releases the claims, and tombstones the session so a
 * handoff still on its way here cannot acquire one afterwards.
 */
export function dropSessionHandoffs(sessionId: string): void {
  dropped.add(sessionId)
  for (const handoff of [...handoffs.values()]) {
    if (handoff.sessionId !== sessionId) continue
    settle(handoff)
  }
}

/** Everything still waiting on a job row, for the Storage figure and for tests. */
export function failedHandoffs(sessionId?: string): Handoff[] {
  const all = [...handoffs.values()].filter((h) => h.state === 'failed' || h.state === 'enqueueing')
  return sessionId ? all.filter((h) => h.sessionId === sessionId) : all
}

/** Tests only. */
export function resetPendingHandoffs(): void {
  for (const handoff of handoffs.values()) handoff.cancelRetry?.()
  handoffs.clear()
  dropped.clear()
}
