/**
 * Transfer jobs (`docs/design/session-sync-zone.md` §5.3).
 *
 * One worker per live remote connection, started next to the Host Action
 * consumer and stopped with it. It drains the persisted job table for that
 * connection: resumes each upload from its recorded offset, backs off on
 * failure, and drops a job when its session is deleted. Throughput is measured
 * per connection and feeds the executor's claim-budget decision (§4.1).
 */
import { statSync } from 'node:fs'
import { canonicalClaimPath } from './active-writes'
import { dropSessionHandoffs, failedHandoffs, retryFailedHandoffs, setPendingJobLookup } from './pending-handoffs'

/**
 * Job states whose bytes the node does not have yet. `uploaded` and
 * `notifying` are deliberately absent: those rows are waiting on the
 * completion wake and no longer own the file's content, so a later delivery of
 * a *newer* version must not be made to join them.
 */
const OWES_UPLOAD = new Set(['pending', 'running', 'failed'])
import type { ArtifactPutRequest, ArtifactPutResult } from '@superone/shared/environment'
import {
  deleteArtifactTransfersForSession,
  listArtifactTransfersForSession,
  reviveArtifactTransfer,
  enqueueArtifactTransfer,
  listPendingArtifactTransfers,
  listRunnableArtifactTransfers,
  markArtifactTransferDone,
  markArtifactTransferFailed,
  markArtifactTransferRunning,
  markArtifactTransferUploaded,
  claimArtifactTransfer,
  recordArtifactTransferOffset,
  type ArtifactTransferJob,
} from '../db-artifact-transfers'
import { uploadArtifact, type TransferOutcome } from './artifact-transfer'

/** Bytes per millisecond assumed for a connection nothing has been measured on yet (~1 MiB/s). */
export const DEFAULT_THROUGHPUT_BYTES_PER_MS = 1024
const MAX_ATTEMPTS = 8
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 10 * 60_000

export interface ArtifactTransferDeps {
  put: (connectionId: string, input: ArtifactPutRequest) => Promise<ArtifactPutResult>
  /**
   * Tell the session's agent the file landed (§4.1). Optional so a host
   * without the notification RPC (an older node, a unit test) still transfers.
   */
  notifyCompleted?: (
    connectionId: string,
    input: { sessionId: string; notificationId: string; relativePaths: string[] },
  ) => Promise<{ delivered: boolean }>
  log?: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void }
  now?: () => number
}

/** A node that answers this way will never accept the wake: the session is gone. */
const TERMINAL_NOTIFY_ERRORS = new Set(['not_found', 'forbidden', 'failed_precondition', 'unimplemented', 'method_not_found'])

/** Exponential moving average of measured bytes/ms, one per connection. */
class ThroughputMeter {
  private readonly rates = new Map<string, number>()

  bytesPerMs(connectionId: string): number {
    return this.rates.get(connectionId) ?? DEFAULT_THROUGHPUT_BYTES_PER_MS
  }

  record(connectionId: string, outcome: TransferOutcome): void {
    if (outcome.ms <= 0 || outcome.bytes <= 0) return
    const sample = outcome.bytes / outcome.ms
    const prev = this.rates.get(connectionId)
    this.rates.set(connectionId, prev === undefined ? sample : prev * 0.7 + sample * 0.3)
  }
}

export class ArtifactTransferService {
  private readonly meter = new ThroughputMeter()
  private readonly workers = new Map<string, { abort: AbortController; loop: Promise<void>; wake: () => void }>()
  private readonly inflight = new Map<string, AbortController>()

  constructor(private readonly deps: ArtifactTransferDeps) {
    // How a new delivery finds out that a persisted job already owns this
    // file. Without it a row that exists but has not been picked up yet is
    // invisible, and the next Host Action pushes the same file again under a
    // second transfer id — which the node cannot dedupe, and whose loser
    // eventually overwrites the winner.
    setPendingJobLookup((sessionId, localPath) => {
      const real = canonicalClaimPath(localPath)
      const jobs = listArtifactTransfersForSession(sessionId)
      for (const job of jobs) {
        if (!OWES_UPLOAD.has(job.state)) continue
        if (canonicalClaimPath(job.localPath) !== real) continue
        // `failed` is terminal: the worker's queries exclude it, so joining one
        // would answer "on its way" about a delivery nothing will ever perform.
        // A caller asking for this file again is the reason to try once more,
        // so the row goes back in the queue under its own id and offset.
        if (job.state === 'failed' && !reviveArtifactTransfer(job.jobId)) continue
        this.workers.get(job.connectionId)?.wake()
        return { status: 'found', transferId: job.transferId }
      }
      return { status: 'absent' }
    })
  }

  throughputBytesPerMs(connectionId: string): number {
    return this.meter.bytesPerMs(connectionId)
  }

  /** Feed the meter from an eager upload the executor did itself. */
  recordThroughput(connectionId: string, outcome: TransferOutcome): void {
    this.meter.record(connectionId, outcome)
  }

  /**
   * Record a file an eager push already delivered, so a caller that was told
   * "deferred, you will be notified" still gets its wake.
   *
   * The row starts in `uploaded`, never `pending`: only the notification is
   * owed. Enqueueing it normally would re-upload bytes the node already has,
   * and — worse — would let this copy overwrite whatever the agent did to the
   * file on the node in the meantime.
   */
  noteDelivered(input: { connectionId: string; sessionId: string; localPath: string; relativePath: string; transferId: string }): void {
    let total = 0
    try {
      total = statSync(input.localPath).size
    } catch {
      /* delivered and then removed locally; the notification still stands */
    }
    // One statement, in `uploaded` from the start. The previous shape — insert
    // `pending`, then update to `uploaded` — left a row that re-uploads the
    // file if the second statement fails, and the caller's own error handling
    // then filed a second one beside it.
    enqueueArtifactTransfer({ ...input, total, state: 'uploaded' })
    this.workers.get(input.connectionId)?.wake()
  }

  /** Persist a deferred upload and nudge the connection's worker. */
  defer(input: { connectionId: string; sessionId: string; localPath: string; relativePath: string; transferId?: string }): ArtifactTransferJob {
    const total = statSync(input.localPath).size
    const job = enqueueArtifactTransfer({ ...input, total })
    this.workers.get(input.connectionId)?.wake()
    return job
  }

  /** Session deletion (§7): forget the jobs and cancel any upload in progress. */
  dropSession(sessionId: string): void {
    for (const jobId of deleteArtifactTransfersForSession(sessionId)) {
      this.inflight.get(jobId)?.abort()
      this.inflight.delete(jobId)
    }
    // A handoff waiting to be retried has nowhere to go once the session is
    // gone, and the write claim it was protecting would outlive everything
    // that could ever release it.
    dropSessionHandoffs(sessionId)
  }

  /**
   * Retry the files that could not be written onto the job table at all.
   *
   * These are not deferred jobs — there is no row for them — so no worker
   * would ever pick them up. Each is still protected from the mirror, and
   * stays protected until its row exists.
   */
  retryFailedHandoffs(connectionId?: string): { retried: number } {
    return retryFailedHandoffs(connectionId)
  }

  /** What could not be queued, for Settings to show and for a manual retry. */
  failedHandoffs(sessionId?: string) {
    return failedHandoffs(sessionId)
  }

  start(connectionId: string): void {
    // A handoff that could not be written to the table is invisible to the
    // worker loop, so starting the worker is also when they get another go.
    this.retryFailedHandoffs(connectionId)
    if (this.workers.has(connectionId)) return
    const abort = new AbortController()
    let wake: () => void = () => {}
    const loop = this.run(connectionId, abort.signal, (register) => { wake = register })
    this.workers.set(connectionId, { abort, loop, wake: () => wake() })
  }

  stop(connectionId: string): void {
    const worker = this.workers.get(connectionId)
    if (!worker) return
    this.workers.delete(connectionId)
    worker.abort.abort()
    worker.wake()
  }

  stopAll(): void {
    for (const id of [...this.workers.keys()]) this.stop(id)
  }

  /** One pass over the runnable jobs of a connection. The worker loop calls this; tests call it directly. */
  async runOnce(connectionId: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const now = this.deps.now ?? Date.now
    let jobs: ArtifactTransferJob[] = []
    try {
      jobs = listRunnableArtifactTransfers(connectionId, now())
    } catch (err) {
      this.deps.log?.warn('[artifact-transfer] list failed', err)
      return
    }
    for (const job of jobs) {
      if (signal.aborted) return
      await this.runJob(job, signal)
    }
  }

  private async run(connectionId: string, signal: AbortSignal, registerWake: (wake: () => void) => void): Promise<void> {
    const now = this.deps.now ?? Date.now
    while (!signal.aborted) {
      await this.runOnce(connectionId, signal)
      if (signal.aborted) break
      // Sleep until nudged (a new job, a stop) or until the earliest backoff is due.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.nextDueDelay(connectionId, now()))
        registerWake(() => { clearTimeout(timer); resolve() })
      })
    }
  }

  private nextDueDelay(connectionId: string, nowMs: number): number {
    try {
      const pending = listPendingArtifactTransfers(connectionId)
      const due = pending.map((j) => j.nextAttemptAt ?? nowMs).filter((t) => t > nowMs)
      if (due.length === 0) return pending.length > 0 ? 1_000 : BACKOFF_MAX_MS
      return Math.max(250, Math.min(...due) - nowMs)
    } catch {
      return BACKOFF_MAX_MS
    }
  }

  /**
   * Wake the agent for a landed file. A node that says the session is gone
   * ends the job; anything else is a retry, because the agent was told the
   * path would work and nothing else will tell it that it does.
   */
  private async notify(job: ArtifactTransferJob): Promise<void> {
    if (!this.deps.notifyCompleted) {
      markArtifactTransferDone(job.jobId)
      return
    }
    try {
      await this.deps.notifyCompleted(job.connectionId, {
        sessionId: job.sessionId,
        notificationId: job.jobId,
        relativePaths: [job.relativePath],
      })
      markArtifactTransferDone(job.jobId)
    } catch (err) {
      const code = String((err as { code?: unknown }).code ?? '')
      const message = err instanceof Error ? err.message : String(err)
      if (TERMINAL_NOTIFY_ERRORS.has(code)) {
        this.deps.log?.warn('[artifact-transfer] wake refused, dropping job', job.relativePath, code)
        markArtifactTransferDone(job.jobId)
        return
      }
      const attempts = job.attempts + 1
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 10))
      try {
        // Back to `uploaded`: the next attempt must wake, never re-upload.
        markArtifactTransferFailed(job.jobId, message, (this.deps.now ?? Date.now)() + delay, 'uploaded')
      } catch { /* row dropped with the session */ }
      this.deps.log?.warn('[artifact-transfer] wake failed', job.relativePath, message, `(retry in ${delay}ms)`)
    }
  }

  private async runJob(job: ArtifactTransferJob, workerSignal: AbortSignal): Promise<void> {
    const abort = new AbortController()
    const onWorkerAbort = () => abort.abort()
    workerSignal.addEventListener('abort', onWorkerAbort, { once: true })
    this.inflight.set(job.jobId, abort)
    try {
      // The bytes are already there; only the agent's wake is still owed.
      if (job.state === 'uploaded' || job.state === 'notifying') {
        if (!claimArtifactTransfer(job.jobId, 'notifying')) return
        await this.notify(job)
        return
      }
      // The pass works from a snapshot; a session deleted since then took its row with it.
      if (!markArtifactTransferRunning(job.jobId)) return
      const outcome = await uploadArtifact({
        localPath: job.localPath,
        sessionId: job.sessionId,
        relativePath: job.relativePath,
        transferId: job.transferId,
        offset: job.offset,
        signal: abort.signal,
        put: (input) => this.deps.put(job.connectionId, input),
        onProgress: (offset) => {
          try { recordArtifactTransferOffset(job.jobId, offset) } catch { /* row dropped with the session */ }
        },
      })
      this.meter.record(job.connectionId, outcome)
      this.deps.log?.info('[artifact-transfer] uploaded', job.relativePath, `${outcome.bytes}B`)
      // The row survives the upload: the agent has an ENOENT to take back and
      // is only told the path works once the node confirms the wake.
      markArtifactTransferUploaded(job.jobId)
      if (!claimArtifactTransfer(job.jobId, 'notifying')) return
      await this.notify(job)
    } catch (err) {
      if (abort.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      const missingLocal = (err as { code?: string }).code === 'ENOENT'
      const attempts = job.attempts + 1
      const giveUp = missingLocal || attempts >= MAX_ATTEMPTS
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 10))
      try {
        markArtifactTransferFailed(job.jobId, message, giveUp ? null : (this.deps.now ?? Date.now)() + delay)
      } catch { /* row dropped with the session */ }
      this.deps.log?.warn('[artifact-transfer] upload failed', job.relativePath, message, giveUp ? '(giving up)' : `(retry in ${delay}ms)`)
    } finally {
      workerSignal.removeEventListener('abort', onWorkerAbort)
      this.inflight.delete(job.jobId)
    }
  }
}
