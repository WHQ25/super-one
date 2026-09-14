/**
 * The transfer worker over the delivery record
 * (`docs/design/session-sync-zone-delivery-record.md` §6).
 *
 * One worker per live remote connection, started next to the Host Action
 * consumer and stopped with it. Each pass lists the connection's live rows
 * that are due, skips the ones whose holder is still working, claims the rest
 * from their dead or absent holders, and continues each from the phase it
 * actually reached:
 *
 * - `writing` with a dead holder: the producer died. Abandoned, never sent —
 *   nothing records how far it got, and a half file is worse than none.
 * - `sealed` / `queued`: a complete source waiting. Uploaded.
 * - `uploading`: the final put was never sent (or the row would be
 *   `committing`), so the node has at most a `.parts` fragment. Resumed.
 * - `committing` with a dead holder: the final put was sent and its reply
 *   lost. Unknowable from here (§2), so automatic retry stops and a person
 *   re-delivers under a new path.
 * - `uploaded` / `notifying`: the bytes are on the node; only the wake is
 *   owed. Notified, never uploaded — there is no path back to `uploading`.
 *
 * Every step is a compare-and-set under the worker's own holder, so a pass
 * that lost a row to a concurrent claim stops instead of acting on it. A
 * failure records itself against the row — error, backoff, or giving up — and
 * never moves the phase.
 */
import { isHolderAlive, mintHolder, retireHolder } from './delivery-holders'
import {
  abandonDelivery,
  advanceDelivery,
  claimDelivery,
  completeDelivery,
  dropSessionDeliveries,
  listGivenUpDeliveries,
  listLiveDeliveries,
  nextDeliveryDueAt,
  recordDeliveryFailure,
  recordDeliveryOffset,
  retryGivenUpDeliveries,
  type Delivery,
  type DeliveryHandle,
} from '../db-session-deliveries'
import type { ArtifactPutRequest, ArtifactPutResult } from '@superone/shared/environment'
import { uploadArtifact, type TransferOutcome } from './artifact-transfer'

/** Bytes per millisecond assumed for a connection nothing has been measured on yet (~1 MiB/s). */
export const DEFAULT_THROUGHPUT_BYTES_PER_MS = 1024
/** Upload attempts before automatic retry stops. Never applied once the bytes are on the node. */
const MAX_UPLOAD_ATTEMPTS = 8
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 10 * 60_000

export interface ArtifactTransferDeps {
  put: (connectionId: string, input: ArtifactPutRequest) => Promise<ArtifactPutResult>
  /**
   * Tell the session's agent the file landed (§4.1 of the parent design).
   * Optional so a host without the notification RPC (an older node, a unit
   * test) still transfers.
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

/** The worker lost the row mid-step: someone else advanced or took it. */
class LostDelivery extends Error {
  constructor() {
    super('delivery lost to another holder')
    this.name = 'LostDelivery'
  }
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

  /** Something new is waiting for this connection's worker. */
  wake(connectionId: string): void {
    this.workers.get(connectionId)?.wake()
  }

  /**
   * Session deletion (§6): tombstone the session, abandon its live rows, and
   * cancel any upload of theirs in flight. The upload's own failure handling
   * sees an abort, not an error, and records nothing.
   */
  dropSession(sessionId: string): void {
    for (const deliveryId of dropSessionDeliveries(sessionId)) {
      this.inflight.get(deliveryId)?.abort()
      this.inflight.delete(deliveryId)
    }
  }

  /**
   * Settings' Retry Upload: rows that gave up go back in the queue — except a
   * `committing` row, which only a re-delivery under a new path can clear.
   */
  retryGivenUp(sessionId?: string): { retried: number } {
    const ids = retryGivenUpDeliveries(sessionId)
    for (const id of this.workers.keys()) this.wake(id)
    return { retried: ids.length }
  }

  /** What automatic retry has stopped on, for Settings to show. */
  givenUp(sessionId?: string): Delivery[] {
    return listGivenUpDeliveries(sessionId)
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

  /** One pass over the connection's due rows. The worker loop calls this; tests call it directly. */
  async runOnce(connectionId: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const now = this.deps.now ?? Date.now
    let rows: Delivery[]
    try {
      rows = listLiveDeliveries(connectionId, now())
    } catch (err) {
      this.deps.log?.warn('[artifact-transfer] could not list deliveries', err)
      return
    }
    for (const row of rows) {
      if (signal.aborted) return
      // Still being worked — by a producer filling it, an eager push sending
      // it, or another pass of ours. Not a candidate.
      if (isHolderAlive(row.holder)) continue
      await this.runDelivery(row, signal)
    }
  }

  private async run(connectionId: string, signal: AbortSignal, registerWake: (wake: () => void) => void): Promise<void> {
    const now = this.deps.now ?? Date.now
    while (!signal.aborted) {
      await this.runOnce(connectionId, signal)
      if (signal.aborted) break
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.nextDueDelay(connectionId, now()))
        registerWake(() => { clearTimeout(timer); resolve() })
      })
    }
  }

  private nextDueDelay(connectionId: string, nowMs: number): number {
    try {
      const due = nextDeliveryDueAt(connectionId)
      if (due === null) return BACKOFF_MAX_MS
      return Math.max(250, due - nowMs)
    } catch {
      return BACKOFF_MAX_MS
    }
  }

  private async runDelivery(row: Delivery, workerSignal: AbortSignal): Promise<void> {
    const holder = mintHolder()
    const claimed = claimDelivery(row.deliveryId, { holder: row.holder, epoch: row.epoch }, holder)
    if (!claimed.ok) {
      retireHolder(holder)
      return
    }
    // Moves as the phase does, so the failure path records against the epoch
    // actually reached — and knows whether the final put was already sent.
    const cursor = { handle: claimed.handle, committing: false }
    const abort = new AbortController()
    const onWorkerAbort = () => abort.abort()
    workerSignal.addEventListener('abort', onWorkerAbort, { once: true })
    this.inflight.set(row.deliveryId, abort)
    /** Set once the node is known to hold the bytes: an error after this is never an upload failure. */
    let delivered = false
    try {
      switch (row.phase) {
        case 'writing':
          abandonDelivery(cursor.handle)
          this.deps.log?.warn('[artifact-transfer] abandoned a half-written file whose producer is gone', row.relativePath)
          return
        case 'committing':
          // The final put went out and nothing says whether it landed. Nothing
          // here can find out (§2), so nothing here retries it.
          recordDeliveryFailure(cursor.handle, { error: 'commit unverified', nextAttemptAt: null })
          this.deps.log?.warn('[artifact-transfer] final put unverified; needs re-delivery under a new path', row.relativePath)
          return
        case 'sealed':
        case 'queued': {
          const started = advanceDelivery(cursor.handle, { from: row.phase, to: 'uploading' })
          if (!started.ok) throw new LostDelivery()
          cursor.handle = started.handle
          await this.upload(row, cursor, abort.signal)
          delivered = true
          break
        }
        case 'uploading':
          await this.upload(row, cursor, abort.signal)
          delivered = true
          break
        case 'uploaded':
        case 'notifying':
          delivered = true
          break
      }
      // Every path out of the switch is at `uploaded`, except a row that came in
      // already `notifying` — a wake that failed last time and is being retried.
      if (row.phase !== 'notifying') {
        const notifying = advanceDelivery(cursor.handle, { from: 'uploaded', to: 'notifying' })
        if (!notifying.ok) throw new LostDelivery()
        cursor.handle = notifying.handle
      }
      await this.notify(row, cursor.handle)
    } catch (err) {
      if (abort.signal.aborted || err instanceof LostDelivery) return
      const message = err instanceof Error ? err.message : String(err)
      const attempts = row.attempts + 1
      const missingLocal = (err as { code?: string }).code === 'ENOENT'
      // The final put went out and its reply did not come back: unknowable
      // from here (§2), so automatic retry stops right now rather than after
      // a backoff that would resend the final chunk.
      const unverified = cursor.committing && !delivered
      // A delivered file cannot fail for want of a local copy, and never gives
      // up: the bytes are on the node and only the wake is outstanding.
      const giveUp = unverified || (!delivered && (missingLocal || attempts >= MAX_UPLOAD_ATTEMPTS))
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 10))
      recordDeliveryFailure(cursor.handle, {
        error: unverified ? `commit unverified: ${message}` : message,
        nextAttemptAt: giveUp ? null : (this.deps.now ?? Date.now)() + delay,
      })
      this.deps.log?.warn('[artifact-transfer] delivery failed', row.relativePath, message, giveUp ? '(giving up)' : `(retry in ${delay}ms)`)
    } finally {
      workerSignal.removeEventListener('abort', onWorkerAbort)
      this.inflight.delete(row.deliveryId)
      retireHolder(holder)
    }
  }

  /**
   * Send the bytes, resuming from the recorded offset, under the record's
   * fixed identity. The `committing` gate is written immediately before the
   * final chunk goes out; a gate that cannot be written sends nothing.
   */
  private async upload(row: Delivery, cursor: { handle: DeliveryHandle; committing: boolean }, signal: AbortSignal): Promise<void> {
    const outcome = await uploadArtifact({
      localPath: row.localPath,
      sessionId: row.sessionId,
      relativePath: row.relativePath,
      transferId: row.transferId,
      offset: row.offset,
      ...(row.sha256 ? { identity: { total: row.total, sha256: row.sha256 } } : {}),
      signal,
      put: (input) => this.deps.put(row.connectionId, input),
      onProgress: (offset) => void recordDeliveryOffset(cursor.handle, offset),
      beforeFinal: () => {
        // Idempotent: an offset resync can re-send a final chunk, and the gate
        // has already been written for it.
        if (cursor.committing) return
        const gate = advanceDelivery(cursor.handle, { from: 'uploading', to: 'committing' })
        if (!gate.ok) throw new LostDelivery()
        cursor.handle = gate.handle
        cursor.committing = true
      },
    })
    this.meter.record(row.connectionId, outcome)
    this.deps.log?.info('[artifact-transfer] uploaded', row.relativePath, `${outcome.bytes}B`)
    const landed = advanceDelivery(cursor.handle, { from: 'committing', to: 'uploaded' })
    if (!landed.ok) throw new LostDelivery()
    cursor.handle = landed.handle
  }

  /**
   * Wake the agent for a landed file. A node that says the session is gone
   * ends the delivery; anything else is retried, because the agent was told
   * the path would work and nothing else will tell it that it does.
   */
  private async notify(row: Delivery, handle: DeliveryHandle): Promise<void> {
    if (this.deps.notifyCompleted) {
      try {
        await this.deps.notifyCompleted(row.connectionId, {
          sessionId: row.sessionId,
          notificationId: row.deliveryId,
          relativePaths: [row.relativePath],
        })
      } catch (err) {
        const code = String((err as { code?: unknown }).code ?? '')
        if (!TERMINAL_NOTIFY_ERRORS.has(code)) throw err
        this.deps.log?.warn('[artifact-transfer] wake refused, ending delivery', row.relativePath, code)
        abandonDelivery(handle)
        return
      }
    }
    if (!completeDelivery(handle)) throw new LostDelivery()
  }
}
