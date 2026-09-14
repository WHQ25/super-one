/**
 * One handoff task per zone file, from the first attempt to file it as a
 * transfer job until a row actually exists (`docs/design/session-sync-zone.md`
 * §4.1).
 *
 * `defer` is purely local — `statSync`, a SQLite insert, a worker wake — so it
 * fails for local reasons: the database is busy, the connection has no
 * transfer service yet. A node being unreachable does NOT land here; that is
 * what the worker's backoff over persisted jobs is for.
 *
 * Both routes to a job reach this table, which is the point of it existing:
 * `syncHostActionOutputs` when its eager push is skipped or fails, and
 * `queueDownloadUpload` for a page-started download that finished outside any
 * tool call. They are the same responsibility arriving from two directions,
 * and the previous split between them produced three separate defects.
 *
 * ## The task owns the protection, not a note about it
 *
 * The first version of this file recorded a failure and a `holder`, and
 * assumed the claim already existed. Only downloads reserve a path, so only
 * downloads had one: a screenshot whose enqueue failed got a tidy record and
 * no protection, and the next directory mirror deleted it. A task now *takes*
 * its claim — `takeSealedClaim` creates one when the producer never did — so
 * "there is a task" and "the file is protected" cannot come apart.
 *
 * ## One task per path, identity and all
 *
 * Re-entering for a path that already has a task returns that task. Nothing
 * about it is overwritten:
 *
 * - **The `transferId` is created once.** A second listing that re-registers
 *   the same download used to mint a new id, which loses the node's partial
 *   upload and makes it meet a second transfer for one file.
 * - **The holder is whatever the task actually took**, never what a caller
 *   guessed. Claiming `push` for a file the task already held left a claim
 *   nobody could release, and a sealed claim that outlives its handoff wins
 *   over the node for ever — the mirror keeps serving the desktop's old copy
 *   of a file the agent has since changed on the node.
 *
 * ## Deletion wins over a retry in flight
 *
 * The retry ladder lives on the task, cancellable, and every step re-checks
 * the session's generation. A session deleted between two attempts used to see
 * its entry reappear afterwards — with a claim on a file that no longer
 * existed, and a Settings retry that could only ever `stat` an absent path.
 *
 * This table is in memory. A desktop that quits with tasks in it loses their
 * protection — see §9; there is no crash-recovery journal, and this file does
 * not pretend otherwise.
 */
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
 * generation check that stops work for a deleted session has to sit
 * immediately before the call with nothing in between. An enqueue that awaits
 * internally would have been entered already by the time anyone could refuse
 * it, so a caller with an async dependency resolves it BEFORE building the
 * task, not inside the enqueue.
 */
export type EnqueueJob = (job: HandoffJob) => void

/** Where a task is. `queued` tasks are removed, so it never appears in the table. */
export type HandoffState = 'enqueueing' | 'failed'

export interface HandoffTask {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  /** Minted once per path and reused by every attempt, so the node resumes rather than restarts. */
  transferId: string
  state: HandoffState
  /** True when this task took the write claim and must release it on success. */
  holdsClaim: boolean
  attempts: number
  lastError: string | null
  bytes: number
  enqueue: EnqueueJob
  cancelRetry: (() => void) | null
}

/** Delays before each retry. Short: the file is unprotected work in progress. */
const RETRY_DELAYS_MS = [100, 500, 2000, 5000]

const tasks = new Map<string, HandoffTask>()
/**
 * Sessions that have been deleted. A session id is never reused, so this is a
 * tombstone rather than a generation counter — and it has to outlive the
 * tasks, because the case it exists for is a handoff *arriving* after the
 * delete: a caller that awaited something before filing (resolving the
 * environment host, say) and comes back to a session that is gone.
 */
const dropped = new Set<string>()

function keyFor(connectionId: string, sessionId: string, localPath: string): string {
  return `${connectionId}\t${sessionId}\t${canonicalClaimPath(localPath)}`
}

function stale(task: HandoffTask): boolean {
  return dropped.has(task.sessionId)
}

/**
 * The id an earlier attempt on this path already established, if any.
 *
 * `syncHostActionOutputs` asks before it uploads: a file that has been through
 * a failed handoff may already have partial bytes on the node under that id,
 * and a fresh one would abandon them.
 */
export function handoffTransferId(connectionId: string, sessionId: string, localPath: string): string | null {
  return tasks.get(keyFor(connectionId, sessionId, localPath))?.transferId ?? null
}

/** Does a live handoff task own this path's claim? Its holder must not release it. */
export function handoffOwns(sessionId: string, localPath: string, connectionId?: string): boolean {
  if (connectionId) return tasks.has(keyFor(connectionId, sessionId, localPath))
  const suffix = `\t${sessionId}\t${canonicalClaimPath(localPath)}`
  for (const key of tasks.keys()) if (key.endsWith(suffix)) return true
  return false
}

/**
 * File `job` as a transfer job, keeping the file protected until it lands.
 *
 * Synchronous up to and including taking the claim, because that is what makes
 * the file safe; the attempt itself is not. Re-entering for a path that
 * already has a task is a no-op beyond returning it — the task in flight keeps
 * its id, its claim and its retry schedule.
 */
export function handoffArtifact(input: {
  connectionId: string
  sessionId: string
  localPath: string
  relativePath: string
  transferId: string
  bytes: number
  enqueue: EnqueueJob
}): HandoffTask | null {
  // Deleted while the caller was getting here. Filing now would write a row
  // for a session that no longer exists and take a claim on a file that was
  // removed with it.
  if (dropped.has(input.sessionId)) return null
  const key = keyFor(input.connectionId, input.sessionId, input.localPath)
  const existing = tasks.get(key)
  if (existing && !stale(existing)) return existing

  const task: HandoffTask = {
    connectionId: input.connectionId,
    sessionId: input.sessionId,
    localPath: input.localPath,
    relativePath: input.relativePath,
    transferId: input.transferId,
    state: 'enqueueing',
    // Taken here, synchronously: from this line the mirror will not delete or
    // overwrite the file, whether or not its producer ever claimed a path.
    holdsClaim: takeSealedClaim(input.sessionId, input.localPath, 'handoff'),
    attempts: 0,
    lastError: null,
    bytes: input.bytes,
    enqueue: input.enqueue,
    cancelRetry: null,
  }
  tasks.set(key, task)
  attempt(key, task)
  return task
}

function attempt(key: string, task: HandoffTask): void {
  if (stale(task)) return
  task.attempts += 1
  try {
    task.enqueue({
      connectionId: task.connectionId,
      sessionId: task.sessionId,
      localPath: task.localPath,
      relativePath: task.relativePath,
      transferId: task.transferId,
    })
  } catch (err) {
    task.state = 'failed'
    task.lastError = err instanceof Error ? err.message : String(err)
    scheduleRetry(key, task)
    return
  }
  settle(key, task)
}

/** The row exists: the job protects the file from here on, so the task lets go. */
function settle(key: string, task: HandoffTask): void {
  task.cancelRetry?.()
  tasks.delete(key)
  if (task.holdsClaim) releaseWriteClaim(task.sessionId, task.localPath, 'handoff')
}

function scheduleRetry(key: string, task: HandoffTask): void {
  const delay = RETRY_DELAYS_MS[task.attempts - 1]
  if (delay === undefined) {
    log.warn(
      '[artifact-handoff] %s could not be queued after %d attempts (%s); the desktop copy stays protected until a retry succeeds',
      task.relativePath,
      task.attempts,
      task.lastError,
    )
    return
  }
  const timer = setTimeout(() => {
    task.cancelRetry = null
    attempt(key, task)
  }, delay)
  task.cancelRetry = () => clearTimeout(timer)
}

/**
 * Try the failed tasks again, releasing each claim only once its row exists.
 * Called when a connection's transfer worker starts or resumes, and from the
 * Settings retry action.
 */
export function retryFailedHandoffs(connectionId?: string): { retried: number } {
  let retried = 0
  for (const [key, task] of [...tasks]) {
    if (connectionId && task.connectionId !== connectionId) continue
    if (stale(task)) continue
    task.cancelRetry?.()
    task.cancelRetry = null
    // A fresh ladder: this is a new reason to believe it will work.
    task.attempts = 0
    retried += 1
    attempt(key, task)
  }
  return { retried }
}

/**
 * The session is gone (§7): nothing is owed to the node any more. Cancels
 * retries in flight, releases the claims, and bumps the generation so an
 * attempt already running cannot file the entry again afterwards.
 */
export function dropSessionHandoffs(sessionId: string): void {
  dropped.add(sessionId)
  for (const [key, task] of [...tasks]) {
    if (task.sessionId !== sessionId) continue
    task.cancelRetry?.()
    tasks.delete(key)
    if (task.holdsClaim) releaseWriteClaim(task.sessionId, task.localPath, 'handoff')
  }
}

/** Everything still waiting, for the Storage figure and for tests. */
export function failedHandoffs(sessionId?: string): HandoffTask[] {
  const all = [...tasks.values()]
  return sessionId ? all.filter((t) => t.sessionId === sessionId) : all
}

/** Tests only. */
export function resetPendingHandoffs(): void {
  for (const task of tasks.values()) task.cancelRetry?.()
  tasks.clear()
  dropped.clear()
}
