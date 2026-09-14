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
import { dropSessionClaims, releaseWriteClaim, takeSealedClaim, canonicalClaimPath } from './active-writes'
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
 * `blocked` — the file is held, but we cannot yet tell whether a job already
 *   carries it, so no upload identity has been handed out.
 * `notifying` — the bytes are delivered; only the completion record is owed.
 */
export type HandoffState = 'pushing' | 'enqueueing' | 'failed' | 'queued' | 'blocked' | 'notifying'

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
  /** What the retry ladder is for, so a failure lands in the right state. */
  kind: 'upload' | 'notice'
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
export type JobLookupResult =
  | { status: 'found'; transferId: string }
  | { status: 'absent' }
  /** The table could not be read. NOT the same as `absent`. */
  | { status: 'unavailable' }

export type PendingJobLookup = (sessionId: string, localPath: string) => JobLookupResult

let findPendingJob: PendingJobLookup | null = null

export function setPendingJobLookup(lookup: PendingJobLookup | null): void {
  findPendingJob = lookup
}

/**
 * Does a persisted job still owe this file's bytes, and if so under which
 * transfer id? Joining one is not a passive observation — a terminal `failed`
 * row is put back in the queue by the answer — so this is the one question and
 * the one place that asks it.
 */
export function findPendingJobFor(sessionId: string, localPath: string): JobLookupResult {
  if (!findPendingJob) return { status: 'absent' }
  try {
    return findPendingJob(sessionId, localPath)
  } catch (err) {
    // "I could not read the table" is not "there is no job". Answering
    // `absent` here hands out a second delivery for a file a persisted job is
    // already carrying — two uploads under two ids, and the older one wins
    // whenever it happens to run last.
    log.warn('[artifact-handoff] could not check for an existing job: %s', err instanceof Error ? err.message : String(err))
    return { status: 'unavailable' }
  }
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
  /** Used only if the lookup is unavailable and this instance has to file the job itself later. */
  enqueue?: EnqueueJob
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
  const queued = findPendingJobFor(input.sessionId, input.localPath)
  if (queued.status === 'found') {
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
        kind: 'upload',
      },
      mine: false,
    }
  }

  const token = randomUUID()
  if (queued.status === 'unavailable') {
    // Hold the file — that part is never in doubt — but hand out no upload
    // identity until we can tell whether a job already carries it. Reported as
    // not-mine, so no caller pushes and no caller files a row on a guess.
    const blocked: Handoff = {
      ...input,
      transferId: '',
      token,
      state: 'blocked',
      holdsClaim: takeSealedClaim(input.sessionId, input.localPath, token),
      attempts: 0,
      lastError: 'the transfer job table could not be read',
      enqueue: input.enqueue ?? null,
      cancelRetry: null,
      waiters: 0,
      kind: 'upload',
    }
    handoffs.set(key, blocked)
    scheduleRetry(blocked)
    return { handoff: blocked, mine: false }
  }
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
    enqueue: input.enqueue ?? null,
    cancelRetry: null,
    waiters: 0,
    kind: 'upload',
  }
  handoffs.set(key, handoff)
  return { handoff, mine: true }
}

/**
 * Delivery is complete — the bytes are on the node, or it already had them.
 *
 * A caller that joined was told the file is on its way and would be notified,
 * and an eager push is a route its own reply cannot report. `noteDelivered`
 * is how that promise is still kept: it records a job that owes only the
 * completion wake, never a re-upload.
 */
export function deliverHandoff(handoff: Handoff, noteDelivered?: EnqueueJob): void {
  // The bytes are on the node, so the desktop copy stops being authoritative
  // here — before anything that could fail. Holding it past this point keeps
  // the mirror serving our older content over the node's.
  if (handoff.holdsClaim) releaseWriteClaim(handoff.sessionId, handoff.localPath, handoff.token)
  handoff.holdsClaim = false

  if (handoff.waiters <= 0 || !noteDelivered) {
    settle(handoff)
    return
  }
  // Only the wake is outstanding now, and it is its own kind of work: a
  // failure retries the record, never the upload. This function does not
  // throw — a caller that treated a failed notification as a failed push used
  // to file a second upload job beside the delivered file.
  handoff.state = 'notifying'
  handoff.kind = 'notice'
  handoff.enqueue = noteDelivered
  handoff.attempts = 0
  attempt(handoff)
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
  if (dropped.has(handoff.sessionId) || handoffs.get(key) !== handoff) return
  if (handoff.state === 'blocked') return resolveBlocked(handoff)
  if (!handoff.enqueue) return
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
    // A notice retries as a notice. Falling back to `failed` would put it in
    // the Storage "could not be queued for upload" figure and, worse, invite
    // an upload of a file the node already has.
    handoff.state = handoff.kind === 'notice' ? 'notifying' : 'failed'
    handoff.lastError = err instanceof Error ? err.message : String(err)
    scheduleRetry(handoff)
    return
  }
  // The row exists: the job protects the file from here on.
  settle(handoff)
}

/**
 * Ask again whether a job already carries this file, now that the table may be
 * readable.
 *
 * Until it answers, the file is held and nothing has an upload identity for
 * it. `found` means a persisted job has it and this instance was only ever a
 * placeholder; `absent` is the first moment it is safe to become a delivery of
 * our own.
 */
function resolveBlocked(handoff: Handoff): void {
  handoff.attempts += 1
  const answer = findPendingJobFor(handoff.sessionId, handoff.localPath)
  if (answer.status === 'unavailable') {
    scheduleRetry(handoff)
    return
  }
  if (answer.status === 'found') {
    // The row owns it, and the row protects it. Nothing here to do but let go.
    settle(handoff)
    return
  }
  if (!handoff.enqueue) {
    // Nobody gave this instance a way to file a job. Keep holding the file
    // rather than drop the only copy; a retry entry can still resolve it.
    handoff.state = 'failed'
    return
  }
  handoff.transferId = randomUUID()
  handoff.state = 'enqueueing'
  handoff.attempts = 0
  attempt(handoff)
}

function scheduleRetry(handoff: Handoff): void {
  // `attempts` counts tries already made; a `blocked` instance is scheduled
  // before its first, so the index is clamped rather than read as -1.
  const delay = RETRY_DELAYS_MS[Math.max(0, handoff.attempts - 1)]
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
    // Everything that stopped short: an upload that could not be queued, a
    // completion record that could not be written, and a file still waiting to
    // learn whether a job already carries it.
    if (handoff.state === 'pushing' || handoff.state === 'enqueueing') continue
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
  // Including claims no instance holds. A download still streaming when its
  // session was deleted seals into a writer's claim that nothing can adopt —
  // the handoff is refused by the tombstone — and would hold its path for the
  // life of the process.
  dropSessionClaims(sessionId)
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
