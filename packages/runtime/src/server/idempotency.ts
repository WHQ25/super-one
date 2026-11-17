import { createHash } from 'node:crypto'
import type { SqliteDatabase } from '../sqlite'

type Inflight = {
  payloadHash: string
  promise: Promise<unknown>
}

/**
 * Durable receipts + in-process reservation so concurrent same-key RPCs
 * share one execution (no double mutation window).
 */
export class IdempotencyService {
  private readonly inflight = new Map<string, Inflight>()

  constructor(private readonly db: SqliteDatabase) {}

  payloadHash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
  }

  private key(clientIdentity: string, operation: string, idempotencyKey: string): string {
    return `${clientIdentity}\0${operation}\0${idempotencyKey}`
  }

  /**
   * Returns prior result if same key+hash, throws conflict if same key different hash,
   * or null if no receipt yet. Does not apply a liveness check; {@link runExclusive}
   * drops a dead receipt before this rule.
   */
  lookup(clientIdentity: string, operation: string, idempotencyKey: string, payloadHash: string): unknown | null {
    const row = this.receiptRow(clientIdentity, operation, idempotencyKey)
    if (!row) return null
    if (row.request_payload_hash !== payloadHash) throw idempotencyConflict()
    return JSON.parse(row.receipt_json)
  }

  private receiptRow(
    clientIdentity: string,
    operation: string,
    idempotencyKey: string,
  ): { request_payload_hash: string; receipt_json: string } | undefined {
    return this.db
      .prepare(
        `SELECT request_payload_hash, receipt_json FROM idempotency_receipts
         WHERE client_identity = ? AND operation = ? AND idempotency_key = ?`,
      )
      .get(clientIdentity, operation, idempotencyKey) as
      | { request_payload_hash: string; receipt_json: string }
      | undefined
  }

  /**
   * Receipt to replay, or null when `execute` should run. A receipt `isLive`
   * rejects is deleted first, even when the new payload hash differs. A receipt
   * that is still live (or any receipt when no liveness check was given) with
   * a different hash is a conflict.
   */
  private replayReceipt<T>(
    clientIdentity: string,
    operation: string,
    idempotencyKey: string,
    payloadHash: string,
    isLive?: (receipt: T) => boolean,
  ): T | null {
    const row = this.receiptRow(clientIdentity, operation, idempotencyKey)
    if (!row) return null
    const sameHash = row.request_payload_hash === payloadHash
    if (!isLive) {
      if (!sameHash) throw idempotencyConflict()
      return JSON.parse(row.receipt_json) as T
    }
    let receipt: T
    try {
      receipt = JSON.parse(row.receipt_json) as T
    } catch {
      this.delete(clientIdentity, operation, idempotencyKey)
      return null
    }
    if (!isLive(receipt)) {
      this.delete(clientIdentity, operation, idempotencyKey)
      return null
    }
    if (!sameHash) throw idempotencyConflict()
    return receipt
  }

  store(
    clientIdentity: string,
    operation: string,
    idempotencyKey: string,
    payloadHash: string,
    receipt: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO idempotency_receipts
         (client_identity, operation, idempotency_key, request_payload_hash, receipt_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_identity, operation, idempotency_key) DO UPDATE SET
           receipt_json = excluded.receipt_json,
           request_payload_hash = excluded.request_payload_hash`,
      )
      .run(
        clientIdentity,
        operation,
        idempotencyKey,
        payloadHash,
        JSON.stringify(receipt),
        Date.now(),
      )
  }

  /**
   * Serialize concurrent executions of the same idempotency key.
   * Second caller awaits the first execution and re-looks up the receipt.
   *
   * @param options.durable When false, only in-process reservation is used (no SQLite
   *   receipt). Required for ephemeral resources (e.g. watchers) that do not survive
   *   disconnect/restart — durable replay would return a dead id.
   * @param options.isReceiptLive When durable, optional gate: if a stored receipt is no
   *   longer live, it is discarded and execute() runs again, even when the new
   *   payload hash differs. A live receipt with a different hash still conflicts.
   */
  async runExclusive<T>(
    clientIdentity: string,
    operation: string,
    idempotencyKey: string,
    payloadHash: string,
    execute: () => Promise<T>,
    options?: {
      durable?: boolean
      isReceiptLive?: (receipt: T) => boolean
    },
  ): Promise<T> {
    const durable = options?.durable !== false
    const isLive = options?.isReceiptLive

    if (durable) {
      const prior = this.replayReceipt(clientIdentity, operation, idempotencyKey, payloadHash, isLive)
      if (prior !== null) return prior
    }

    const k = this.key(clientIdentity, operation, idempotencyKey)
    const existing = this.inflight.get(k)
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw Object.assign(new Error('idempotency key reused with different payload'), {
          code: 'idempotency_conflict',
        })
      }
      return (await existing.promise) as T
    }

    const promise = (async () => {
      if (durable) {
        const again = this.replayReceipt(clientIdentity, operation, idempotencyKey, payloadHash, isLive)
        if (again !== null) return again
      }
      const result = await execute()
      if (durable) {
        this.store(clientIdentity, operation, idempotencyKey, payloadHash, result)
      }
      return result
    })()

    this.inflight.set(k, { payloadHash, promise })
    try {
      return (await promise) as T
    } finally {
      this.inflight.delete(k)
    }
  }

  delete(clientIdentity: string, operation: string, idempotencyKey: string): void {
    this.db
      .prepare(
        `DELETE FROM idempotency_receipts
         WHERE client_identity = ? AND operation = ? AND idempotency_key = ?`,
      )
      .run(clientIdentity, operation, idempotencyKey)
  }
}

function idempotencyConflict(): Error {
  return Object.assign(new Error('idempotency key reused with different payload'), {
    code: 'idempotency_conflict',
    details: { receiptStored: true },
  })
}
