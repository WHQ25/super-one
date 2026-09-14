import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getDb } from './database'
import { isHolderAlive } from './environment/delivery-holders'
import { canonicalClaimPath } from './environment/sync-zone-paths'
import log from './logger'

/**
 * One row per delivery of one zone file to its node
 * (`docs/design/session-sync-zone-delivery-record.md`).
 *
 * This is the only record of "this file is the newest copy anywhere and
 * somebody owes it to the node". It replaces three: the in-memory write claim,
 * the in-memory transfer instance and the transfer job row, which used to
 * describe the same file in three vocabularies joined by hand-written set
 * predicates, and which keyed on the path rather than on the delivery.
 *
 * Three properties the schema itself enforces, so that no caller has to
 * remember to:
 *
 * - **One content owner per path** (`idx_deliveries_content_slot`): a partial
 *   unique index over the phases that still own the bytes locally. A row that
 *   has delivered leaves the slot; a second writer for the same path is a
 *   constraint violation.
 * - **Phase is monotonic and failure never moves it.** `phase` only advances;
 *   a failed attempt is recorded in `last_error` / `next_attempt_at` /
 *   `gave_up_at`. There is no `failed` phase to overwrite `uploaded` with.
 * - **Every advance is a compare-and-set** on `(delivery_id, phase, epoch)`,
 *   and every takeover on `(delivery_id, holder)`; both bump `epoch`, so a
 *   holder that lost the row cannot act on it with the epoch it remembers.
 *
 * Reads that the mirror makes before deleting or overwriting are synchronous
 * (`better-sqlite3`), so there is no `await` between deciding and acting.
 */

/** The content phases, in order. A delivery only ever moves right. */
export const DELIVERY_PHASES = ['writing', 'sealed', 'queued', 'uploading', 'committing', 'uploaded', 'notifying'] as const
export type DeliveryPhase = (typeof DELIVERY_PHASES)[number]

/** Phases in which the desktop copy is the only complete one, or is being made. */
const CONTENT_OWNING_PHASES = "('writing', 'sealed', 'queued', 'uploading', 'committing')"

export type DeliveryOutcome = 'done' | 'abandoned'
export type DeliveryOrigin = 'download' | 'page-download' | 'produced'

export interface Delivery {
  deliveryId: string
  sessionId: string
  connectionId: string
  localPath: string
  relativePath: string
  transferId: string
  origin: DeliveryOrigin
  phase: DeliveryPhase
  outcome: DeliveryOutcome | null
  holder: string | null
  epoch: number
  offset: number
  total: number
  sha256: string | null
  attempts: number
  nextAttemptAt: number | null
  lastError: string | null
  gaveUpAt: number | null
  createdAt: number
}

interface Row {
  delivery_id: string
  session_id: string
  connection_id: string
  local_path: string
  relative_path: string
  transfer_id: string
  origin: string
  phase: string
  outcome: string | null
  holder: string | null
  epoch: number
  offset: number
  total: number
  sha256: string | null
  attempts: number
  next_attempt_at: string | null
  last_error: string | null
  gave_up_at: string | null
  created_at: string
}

function toDelivery(row: Row): Delivery {
  return {
    deliveryId: row.delivery_id,
    sessionId: row.session_id,
    connectionId: row.connection_id,
    localPath: row.local_path,
    relativePath: row.relative_path,
    transferId: row.transfer_id,
    origin: row.origin as DeliveryOrigin,
    phase: row.phase as DeliveryPhase,
    outcome: row.outcome as DeliveryOutcome | null,
    holder: row.holder,
    epoch: row.epoch,
    offset: row.offset,
    total: row.total,
    sha256: row.sha256,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at ? Date.parse(row.next_attempt_at) : null,
    lastError: row.last_error,
    gaveUpAt: row.gave_up_at ? Date.parse(row.gave_up_at) : null,
    createdAt: Date.parse(row.created_at),
  }
}

const nowIso = (): string => new Date().toISOString()

/**
 * The schema. Idempotent, so the migration and the tests share it and neither
 * can drift from the other. No FK to `sessions`: the session row is the
 * node's, not this database's.
 */
export function ensureSessionFileDeliveriesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_file_deliveries (
      delivery_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      local_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      transfer_id TEXT NOT NULL,
      origin TEXT NOT NULL,
      phase TEXT NOT NULL,
      outcome TEXT,
      holder TEXT,
      epoch INTEGER NOT NULL DEFAULT 0,
      offset INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error TEXT,
      gave_up_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_path
      ON session_file_deliveries(session_id, local_path);
    CREATE INDEX IF NOT EXISTS idx_deliveries_runnable
      ON session_file_deliveries(connection_id, phase, next_attempt_at)
      WHERE outcome IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_content_slot
      ON session_file_deliveries(session_id, local_path)
      WHERE outcome IS NULL AND phase IN ${CONTENT_OWNING_PHASES};
    CREATE TABLE IF NOT EXISTS session_zone_tombstones (
      session_id TEXT PRIMARY KEY,
      dropped_at TEXT NOT NULL
    );
  `)
}

// ---------------------------------------------------------------------------
// Ownership
//
// Every write to a live row goes through a handle: the row's id, the holder
// the caller is acting as, and the epoch it last saw. The compare-and-set
// checks all three. Ownership changes in exactly one place, `claimDelivery`,
// and only from a holder that is NULL or dead; an advance keeps the holder it
// was given. That is what stops a worker that has merely read the epoch from
// walking a row out from under the attempt awaiting its final put.

/** Proof of holding a row at a known epoch. Every write takes one; every successful write returns the next. */
export interface DeliveryHandle {
  deliveryId: string
  holder: string
  epoch: number
}

/** The `WHERE` every owned write shares. */
const OWNED = 'delivery_id = ? AND holder = ? AND epoch = ? AND outcome IS NULL'
const ownedParams = (h: DeliveryHandle): [string, string, number] => [h.deliveryId, h.holder, h.epoch]

// ---------------------------------------------------------------------------
// Creating

export type ReserveDeliveryInput = {
  sessionId: string
  connectionId: string
  localPath: string
  relativePath: string
  origin: DeliveryOrigin
} & (
  | {
      /** A path about to be filled. Someone is writing it, so someone holds it. */
      phase: 'writing'
      holder: string
    }
  | {
      /** A file that is already complete. Held by whoever is about to push it, or by nobody until a worker claims it. */
      phase: 'sealed'
      holder: string | null
      /** Fixed here and never again (R6). */
      total: number
      sha256: string
    }
)

export type ReserveDeliveryResult =
  | { deliveryId: string; epoch: 0; holder: string | null }
  /** The session's zone was deleted; nothing may be produced into it again. */
  | { refused: 'session-dropped' }
  /** A path is written once per session (R2). Pick another name. */
  | { refused: 'path-taken' }

/**
 * Speak for a path before the first byte we control is written. The row is the
 * protection: from here the mirror will neither delete nor overwrite it.
 *
 * One transaction, so the admission checks and the insert cannot be split by
 * a concurrent drop or a concurrent reservation of the same path.
 */
export function reserveDelivery(input: ReserveDeliveryInput): ReserveDeliveryResult {
  if (input.phase === 'sealed' && (typeof input.total !== 'number' || typeof input.sha256 !== 'string')) {
    throw new Error('a delivery reserved sealed must carry its total and sha256')
  }
  const db = getDb()
  const localPath = canonicalClaimPath(input.localPath)
  return db.transaction((): ReserveDeliveryResult => {
    if (db.prepare('SELECT 1 FROM session_zone_tombstones WHERE session_id = ?').get(input.sessionId)) {
      return { refused: 'session-dropped' }
    }
    if (db.prepare('SELECT 1 FROM session_file_deliveries WHERE session_id = ? AND local_path = ? LIMIT 1').get(input.sessionId, localPath)) {
      return { refused: 'path-taken' }
    }
    const deliveryId = randomUUID()
    const now = nowIso()
    db.prepare(
      `INSERT INTO session_file_deliveries
         (delivery_id, session_id, connection_id, local_path, relative_path, transfer_id, origin, phase, holder, total, sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      deliveryId,
      input.sessionId,
      input.connectionId,
      localPath,
      input.relativePath,
      deliveryId,
      input.origin,
      input.phase,
      input.holder,
      input.phase === 'sealed' ? input.total : 0,
      input.phase === 'sealed' ? input.sha256 : null,
      now,
      now,
    )
    return { deliveryId, epoch: 0, holder: input.holder }
  })()
}

// ---------------------------------------------------------------------------
// Advancing

/**
 * One step forward. Size and hash are accepted on the step INTO `sealed` and
 * on no other: after seal the content identity is fixed (R6), and the type
 * says so rather than leaving it to convention.
 */
export type DeliveryStep =
  | { from: 'writing'; to: 'sealed'; total: number; sha256: string }
  | { from: Exclude<DeliveryPhase, 'notifying'>; to: Exclude<DeliveryPhase, 'writing' | 'sealed'> }

export type AdvanceDeliveryResult = { ok: true; handle: DeliveryHandle } | { ok: false }

/**
 * Move the phase forward under the handle. `{ ok: false }` means the row is
 * not at `from`, or is not held by this holder at this epoch any more —
 * either way the caller has lost it and must stop. The holder is kept.
 *
 * A step backwards is a programming error, not a race, and throws.
 */
export function advanceDelivery(handle: DeliveryHandle, step: DeliveryStep): AdvanceDeliveryResult {
  const fromIndex = DELIVERY_PHASES.indexOf(step.from)
  const toIndex = DELIVERY_PHASES.indexOf(step.to)
  if (fromIndex < 0 || toIndex < 0) throw new Error(`unknown delivery phase: ${step.from} → ${step.to}`)
  if (toIndex <= fromIndex) throw new Error(`delivery phase cannot move backwards: ${step.from} → ${step.to}`)
  const sealing = step.to === 'sealed'
  if (!sealing && ('total' in step || 'sha256' in step)) return { ok: false }
  const sets = ['phase = ?', 'epoch = epoch + 1', 'updated_at = ?']
  const params: unknown[] = [step.to, nowIso()]
  if (sealing) {
    sets.push('total = ?', 'sha256 = ?')
    params.push(step.total, step.sha256)
  }
  const result = getDb()
    .prepare(`UPDATE session_file_deliveries SET ${sets.join(', ')} WHERE ${OWNED} AND phase = ?`)
    .run(...params, ...ownedParams(handle), step.from)
  return result.changes === 1 ? { ok: true, handle: { ...handle, epoch: handle.epoch + 1 } } : { ok: false }
}

/**
 * Bytes have landed. Progress is not a state change — the epoch stays — but
 * only the holder may record it: a ghost must not write offsets either.
 */
export function recordDeliveryOffset(handle: DeliveryHandle, offset: number): boolean {
  return (
    getDb()
      .prepare(`UPDATE session_file_deliveries SET offset = ?, updated_at = ? WHERE ${OWNED}`)
      .run(offset, nowIso(), ...ownedParams(handle)).changes === 1
  )
}

/**
 * The attempt is over without the delivery being over: a producer done at
 * `sealed`, a worker stopping. The row is unheld; any pass may claim it.
 */
export function releaseDelivery(handle: DeliveryHandle): boolean {
  return (
    getDb()
      .prepare(`UPDATE session_file_deliveries SET holder = NULL, epoch = epoch + 1, updated_at = ? WHERE ${OWNED}`)
      .run(nowIso(), ...ownedParams(handle)).changes === 1
  )
}

/** The agent has been woken: the delivery is over. Only from `notifying`. */
export function completeDelivery(handle: DeliveryHandle): boolean {
  return (
    getDb()
      .prepare(`UPDATE session_file_deliveries SET outcome = 'done', holder = NULL, epoch = epoch + 1, updated_at = ? WHERE ${OWNED} AND phase = 'notifying'`)
      .run(nowIso(), ...ownedParams(handle)).changes === 1
  )
}

/**
 * Nothing will carry this file: the producer gave up before sealing, the
 * session is gone, or a person re-delivered it under a new path. The row stays
 * — a later reservation of the same path is still refused (R2) — but it
 * protects nothing.
 */
export function abandonDelivery(handle: DeliveryHandle): boolean {
  return (
    getDb()
      .prepare(`UPDATE session_file_deliveries SET outcome = 'abandoned', holder = NULL, epoch = epoch + 1, updated_at = ? WHERE ${OWNED}`)
      .run(nowIso(), ...ownedParams(handle)).changes === 1
  )
}

// ---------------------------------------------------------------------------
// Claiming

export type ClaimDeliveryResult = { ok: true; handle: DeliveryHandle } | { ok: false }

/**
 * Become the holder of a row nobody holds, or that a dead holder left behind
 * — another incarnation, or an attempt that ended without releasing. The
 * phase is untouched; the caller continues from it.
 *
 * Refused while `from.holder` is still alive in this process, and this is
 * enforced here so that no worker pass has to remember to check. Refused
 * when the epoch has moved: a row that was NULL at epoch N, claimed, and
 * released again is not the row the stale snapshot described.
 */
export function claimDelivery(deliveryId: string, from: { holder: string | null; epoch: number }, newHolder: string): ClaimDeliveryResult {
  if (isHolderAlive(from.holder)) return { ok: false }
  const changes = getDb()
    .prepare(
      `UPDATE session_file_deliveries SET holder = ?, epoch = epoch + 1, updated_at = ?
       WHERE delivery_id = ? AND holder IS ? AND epoch = ? AND outcome IS NULL`,
    )
    .run(newHolder, nowIso(), deliveryId, from.holder, from.epoch).changes
  return changes === 1 ? { ok: true, handle: { deliveryId, holder: newHolder, epoch: from.epoch + 1 } } : { ok: false }
}

// ---------------------------------------------------------------------------
// Scheduling — orthogonal to phase

/**
 * The attempt failed. The phase is untouched: the next attempt resumes from
 * where this one actually got to. The holder is released so any pass — in this
 * process or the next — may claim the row once `nextAttemptAt` is due.
 * `nextAttemptAt: null` stops automatic retry; a person may still act.
 */
export function recordDeliveryFailure(handle: DeliveryHandle, input: { error: string; nextAttemptAt: number | null }): boolean {
  const now = nowIso()
  return (
    getDb()
      .prepare(
        `UPDATE session_file_deliveries
         SET holder = NULL, epoch = epoch + 1, attempts = attempts + 1, last_error = ?, next_attempt_at = ?, gave_up_at = ?, updated_at = ?
         WHERE ${OWNED}`,
      )
      .run(
        input.error.slice(0, 500),
        input.nextAttemptAt === null ? null : new Date(input.nextAttemptAt).toISOString(),
        input.nextAttemptAt === null ? now : null,
        now,
        ...ownedParams(handle),
      ).changes === 1
  )
}

/**
 * Settings' Retry Upload: put the rows that gave up back in the queue.
 *
 * Never a `committing` row. Its final put may already have landed and the
 * node's copy may have changed since; sending the original path again is the
 * one thing that must not happen. That row is re-delivered by a person under
 * a new path and a new id, and only that clears it.
 */
export function retryGivenUpDeliveries(sessionId?: string): string[] {
  const db = getDb()
  const where = sessionId ? 'AND session_id = ?' : ''
  const params = sessionId ? [sessionId] : []
  const ids = (
    db.prepare(`SELECT delivery_id FROM session_file_deliveries WHERE gave_up_at IS NOT NULL AND outcome IS NULL AND phase <> 'committing' ${where}`).all(...params) as { delivery_id: string }[]
  ).map((r) => r.delivery_id)
  if (ids.length === 0) return ids
  const placeholders = ids.map(() => '?').join(', ')
  db.prepare(
    `UPDATE session_file_deliveries SET gave_up_at = NULL, next_attempt_at = NULL, attempts = 0, epoch = epoch + 1, updated_at = ?
     WHERE delivery_id IN (${placeholders})`,
  ).run(nowIso(), ...ids)
  return ids
}

// ---------------------------------------------------------------------------
// Session close

/**
 * The session's zone is gone (§7 of the parent design). One transaction:
 * tombstone the session so a late producer cannot reserve into it, and abandon
 * every live row so no holder — alive or dead — can advance one. Returns the
 * ids abandoned, so an upload in flight can be cancelled.
 */
export function dropSessionDeliveries(sessionId: string): string[] {
  const db = getDb()
  return db.transaction((): string[] => {
    const now = nowIso()
    db.prepare('INSERT OR IGNORE INTO session_zone_tombstones (session_id, dropped_at) VALUES (?, ?)').run(sessionId, now)
    const ids = (
      db.prepare('SELECT delivery_id FROM session_file_deliveries WHERE session_id = ? AND outcome IS NULL').all(sessionId) as { delivery_id: string }[]
    ).map((r) => r.delivery_id)
    if (ids.length > 0) {
      db.prepare(
        `UPDATE session_file_deliveries SET outcome = 'abandoned', holder = NULL, epoch = epoch + 1, updated_at = ?
         WHERE session_id = ? AND outcome IS NULL`,
      ).run(now, sessionId)
    }
    return ids
  })()
}

// ---------------------------------------------------------------------------
// Reading

export function getDelivery(deliveryId: string): Delivery | null {
  const row = getDb().prepare('SELECT * FROM session_file_deliveries WHERE delivery_id = ?').get(deliveryId) as Row | undefined
  return row ? toDelivery(row) : null
}

/**
 * The delivery for a path, whatever its phase or outcome — how a later
 * observation of the same file (a re-listing, a mirror read) reuses the
 * identity instead of minting a second one. At most one row per path (R2).
 */
export function findDeliveryByPath(sessionId: string, localPath: string): Delivery | null {
  const row = getDb()
    .prepare('SELECT * FROM session_file_deliveries WHERE session_id = ? AND local_path = ? ORDER BY created_at DESC LIMIT 1')
    .get(sessionId, canonicalClaimPath(localPath)) as Row | undefined
  return row ? toDelivery(row) : null
}

export function listSessionDeliveries(sessionId: string): Delivery[] {
  const rows = getDb().prepare('SELECT * FROM session_file_deliveries WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Row[]
  return rows.map(toDelivery)
}

/**
 * Every live row of a connection that is due and has not given up, in every
 * phase — the worker decides per row whether its holder is alive, whether to
 * take it over, and what the phase asks for.
 */
export function listLiveDeliveries(connectionId: string, nowMs: number): Delivery[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM session_file_deliveries
       WHERE connection_id = ? AND outcome IS NULL AND gave_up_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC`,
    )
    .all(connectionId, new Date(nowMs).toISOString()) as Row[]
  return rows.map(toDelivery)
}

// ---------------------------------------------------------------------------
// What the mirror is told (R4)

/**
 * The mirror's whole view of a path, from one query:
 *
 * - `unavailable`: the table could not be read. Prune nothing, overwrite
 *   nothing, serve nothing. Deliberately not `none`.
 * - `protected-unreadable`: being written, or its final put is in flight and
 *   its outcome unknown. Never deleted, never handed over.
 * - `protected-readable`: the desktop copy is complete and the newest anywhere.
 * - `node-authoritative`: the node has it; the desktop copy may be overwritten.
 * - `none`: no live row. Ordinary mirror behaviour.
 *
 * `outcome` is read before `phase`: an abandoned row protects nothing whatever
 * phase it was abandoned in, and a half file is never served.
 */
export type DeliveryProtection = 'unavailable' | 'protected-unreadable' | 'protected-readable' | 'node-authoritative' | 'none'

const UNREADABLE = new Set<DeliveryPhase>(['writing', 'committing'])
const READABLE = new Set<DeliveryPhase>(['sealed', 'queued', 'uploading'])

function protectionOf(rows: Pick<Row, 'phase' | 'outcome'>[]): DeliveryProtection {
  let strongest: DeliveryProtection = 'none'
  const rank: Record<DeliveryProtection, number> = { none: 0, 'node-authoritative': 1, 'protected-readable': 2, 'protected-unreadable': 3, unavailable: 4 }
  for (const row of rows) {
    let here: DeliveryProtection
    if (row.outcome === 'abandoned') here = 'none'
    else if (row.outcome === 'done') here = 'node-authoritative'
    else if (UNREADABLE.has(row.phase as DeliveryPhase)) here = 'protected-unreadable'
    else if (READABLE.has(row.phase as DeliveryPhase)) here = 'protected-readable'
    else here = 'node-authoritative'
    if (rank[here] > rank[strongest]) strongest = here
  }
  return strongest
}

function unavailable(what: string, err: unknown): DeliveryProtection {
  log.warn('[deliveries] could not read the delivery table for %s; treating it as protected: %s', what, err instanceof Error ? err.message : String(err))
  return 'unavailable'
}

export function classifyDeliveryAt(sessionId: string, localPath: string): DeliveryProtection {
  try {
    const rows = getDb()
      .prepare('SELECT phase, outcome FROM session_file_deliveries WHERE session_id = ? AND local_path = ?')
      .all(sessionId, canonicalClaimPath(localPath)) as Pick<Row, 'phase' | 'outcome'>[]
    return protectionOf(rows)
  } catch (err) {
    return unavailable(localPath, err)
  }
}

/**
 * The strongest protection at or under a directory. A directory is destroyed
 * as a unit, so it answers for its members; `node-authoritative` is a per-file
 * answer and is reported as `none` here — a subtree with only delivered files
 * has nothing the mirror must keep.
 */
export function classifyDeliveriesUnder(sessionId: string, dirPath: string): DeliveryProtection {
  try {
    const dir = canonicalClaimPath(dirPath)
    const rows = getDb()
      .prepare(
        `SELECT phase, outcome FROM session_file_deliveries
         WHERE session_id = ? AND outcome IS NULL AND (local_path = ? OR local_path LIKE ? ESCAPE '\\')`,
      )
      .all(sessionId, dir, `${dir.replace(/[\\%_]/g, '\\$&')}/%`) as Pick<Row, 'phase' | 'outcome'>[]
    const strongest = protectionOf(rows)
    return strongest === 'node-authoritative' ? 'none' : strongest
  } catch (err) {
    return unavailable(dirPath, err)
  }
}
