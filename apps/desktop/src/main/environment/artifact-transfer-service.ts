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
import type { ArtifactPutRequest, ArtifactPutResult } from '@superone/shared/environment'
import {
  deleteArtifactTransfersForSession,
  enqueueArtifactTransfer,
  listRunnableArtifactTransfers,
  markArtifactTransferDone,
  markArtifactTransferFailed,
  markArtifactTransferRunning,
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
  log?: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void }
  now?: () => number
}

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

  constructor(private readonly deps: ArtifactTransferDeps) {}

  throughputBytesPerMs(connectionId: string): number {
    return this.meter.bytesPerMs(connectionId)
  }

  /** Feed the meter from an eager upload the executor did itself. */
  recordThroughput(connectionId: string, outcome: TransferOutcome): void {
    this.meter.record(connectionId, outcome)
  }

  /** Persist a deferred upload and nudge the connection's worker. */
  defer(input: { connectionId: string; sessionId: string; localPath: string; relativePath: string }): ArtifactTransferJob {
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
  }

  start(connectionId: string): void {
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
      const pending = listRunnableArtifactTransfers(connectionId, Number.MAX_SAFE_INTEGER)
      const due = pending.map((j) => j.nextAttemptAt ?? nowMs).filter((t) => t > nowMs)
      if (due.length === 0) return pending.length > 0 ? 1_000 : BACKOFF_MAX_MS
      return Math.max(250, Math.min(...due) - nowMs)
    } catch {
      return BACKOFF_MAX_MS
    }
  }

  private async runJob(job: ArtifactTransferJob, workerSignal: AbortSignal): Promise<void> {
    const abort = new AbortController()
    const onWorkerAbort = () => abort.abort()
    workerSignal.addEventListener('abort', onWorkerAbort, { once: true })
    this.inflight.set(job.jobId, abort)
    try {
      markArtifactTransferRunning(job.jobId)
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
      markArtifactTransferDone(job.jobId)
      this.deps.log?.info('[artifact-transfer] uploaded', job.relativePath, `${outcome.bytes}B`)
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
