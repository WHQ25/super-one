/**
 * Durable Host Action store (SQLite on the node).
 *
 * State machine (v1):
 *   pending → claimed → succeeded | failed
 *   pending | claimed → cancelled
 *
 * `indeterminate` is deliberately deferred. It is only safe to omit because the
 * first host tools are replay-safe. No non-replayable (`unsafe`) action may ship
 * before indeterminate exists; a claimed non-replayable action must never
 * transition back to `pending` (claim expiry cancels instead).
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  HostActionChange,
  HostActionPublicView,
  HostActionReplayPolicy,
  HostActionState,
  HostActionTerminalResult,
} from '@superone/shared/environment'
import type { SqliteDatabase } from '../sqlite'

export const DEFAULT_HOST_ACTION_DEADLINE_MS = 120_000
export const DEFAULT_HOST_ACTION_CLAIM_TTL_MS = 60_000

export interface HostActionRow {
  actionId: string
  sessionId: string
  turnId: string | null
  controllerClientSessionId: string
  toolName: string
  toolGroup: string
  argsJson: string
  replayPolicy: HostActionReplayPolicy
  state: HostActionState
  version: number
  createdAt: number
  deadline: number
  claimTokenHash: string | null
  claimedAt: number | null
  claimExpiresAt: number | null
  resultJson: string | null
  errorJson: string | null
  responsePayloadHash: string | null
  finishedAt: number | null
}

export interface CreateHostActionInput {
  sessionId: string
  turnId?: string | null
  controllerClientSessionId: string
  toolName: string
  toolGroup: string
  args: unknown
  replayPolicy: HostActionReplayPolicy
  deadlineMs?: number
  now?: number
}

export interface ClaimHostActionStoreResult {
  row: HostActionRow
  claimToken: string
}

export interface RespondHostActionStoreResult {
  row: HostActionRow
  duplicate: boolean
}

export type HostActionChangeListener = (change: HostActionChange) => void

export interface HostActionStore {
  create(input: CreateHostActionInput): HostActionRow
  get(actionId: string): HostActionRow | null
  listOutstanding(controllerClientSessionId: string): HostActionPublicView[]
  listChangesAfter(
    controllerClientSessionId: string,
    afterSequence: string,
    limit: number,
  ): HostActionChange[]
  headSequence(): string
  claim(input: {
    actionId: string
    expectedVersion: number
    controllerClientSessionId: string
    claimTtlMs?: number
    now?: number
    /** Caller already verified session binding / grants / active turn. */
  }): ClaimHostActionStoreResult
  respond(input: {
    actionId: string
    claimToken: string
    controllerClientSessionId: string
    outcome: 'succeeded' | 'failed'
    result?: unknown
    error?: unknown
  }): RespondHostActionStoreResult
  /**
   * Cancel pending|claimed actions. Returns cancelled rows (empty if none matched).
   */
  cancel(input: {
    actionId?: string
    sessionId?: string
    reason: string
    now?: number
  }): HostActionRow[]
  /**
   * Requeue expired claimed+safe actions to pending; cancel expired claimed+unsafe.
   * Also cancel any action past its deadline still non-terminal.
   */
  reconcileExpired(now?: number): HostActionRow[]
  /**
   * On node restart: cancel every non-terminal action and return them so waiters settle.
   */
  reconcileAfterRestart(now?: number): HostActionRow[]
  subscribe(listener: HostActionChangeListener): () => void
  toPublic(row: HostActionRow): HostActionPublicView
  toTerminal(row: HostActionRow): HostActionTerminalResult
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function payloadHash(outcome: string, result: unknown, error: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ outcome, result: result ?? null, error: error ?? null }))
    .digest('hex')
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function isTerminal(state: HostActionState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled'
}

function mapRow(r: {
  action_id: string
  session_id: string
  turn_id: string | null
  controller_client_session_id: string
  tool_name: string
  tool_group: string
  args_json: string
  replay_policy: string
  state: string
  version: number
  created_at: number
  deadline: number
  claim_token_hash: string | null
  claimed_at: number | null
  claim_expires_at: number | null
  result_json: string | null
  error_json: string | null
  response_payload_hash: string | null
  finished_at: number | null
}): HostActionRow {
  return {
    actionId: r.action_id,
    sessionId: r.session_id,
    turnId: r.turn_id,
    controllerClientSessionId: r.controller_client_session_id,
    toolName: r.tool_name,
    toolGroup: r.tool_group,
    argsJson: r.args_json,
    replayPolicy: r.replay_policy as HostActionReplayPolicy,
    state: r.state as HostActionState,
    version: r.version,
    createdAt: r.created_at,
    deadline: r.deadline,
    claimTokenHash: r.claim_token_hash,
    claimedAt: r.claimed_at,
    claimExpiresAt: r.claim_expires_at,
    resultJson: r.result_json,
    errorJson: r.error_json,
    responsePayloadHash: r.response_payload_hash,
    finishedAt: r.finished_at,
  }
}

/** Ensure host_actions + host_action_changes tables exist (additive migration). */
export function ensureHostActionTables(db: SqliteDatabase): void {
  // SqliteDatabase may not expose exec — use prepare.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS host_actions (
      action_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      controller_client_session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_group TEXT NOT NULL,
      args_json TEXT NOT NULL,
      replay_policy TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      deadline INTEGER NOT NULL,
      claim_token_hash TEXT,
      claimed_at INTEGER,
      claim_expires_at INTEGER,
      result_json TEXT,
      error_json TEXT,
      response_payload_hash TEXT,
      finished_at INTEGER
    )`,
  ).run()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_host_actions_controller_state
     ON host_actions(controller_client_session_id, state)`,
  ).run()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_host_actions_session
     ON host_actions(session_id)`,
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS host_action_changes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      controller_client_session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      replay_policy TEXT NOT NULL,
      changed_at INTEGER NOT NULL
    )`,
  ).run()
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_host_action_changes_controller_seq
     ON host_action_changes(controller_client_session_id, sequence)`,
  ).run()
}

export function createSqliteHostActionStore(db: SqliteDatabase): HostActionStore {
  ensureHostActionTables(db)
  const listeners = new Set<HostActionChangeListener>()

  const insertChange = (
    row: HostActionRow,
    changedAt: number,
  ): HostActionChange => {
    const result = db
      .prepare(
        `INSERT INTO host_action_changes
         (action_id, session_id, controller_client_session_id, state, version, replay_policy, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.actionId,
        row.sessionId,
        row.controllerClientSessionId,
        row.state,
        row.version,
        row.replayPolicy,
        changedAt,
      )
    const change: HostActionChange = {
      sequence: String(result.lastInsertRowid),
      actionId: row.actionId,
      sessionId: row.sessionId,
      state: row.state,
      version: row.version,
      replayPolicy: row.replayPolicy,
      changedAt,
    }
    for (const l of listeners) {
      try {
        l(change)
      } catch {
        /* listeners must not break store */
      }
    }
    return change
  }

  const load = (actionId: string): HostActionRow | null => {
    const r = db
      .prepare(
        `SELECT action_id, session_id, turn_id, controller_client_session_id, tool_name, tool_group,
                args_json, replay_policy, state, version, created_at, deadline,
                claim_token_hash, claimed_at, claim_expires_at, result_json, error_json,
                response_payload_hash, finished_at
         FROM host_actions WHERE action_id = ?`,
      )
      .get(actionId) as Parameters<typeof mapRow>[0] | undefined
    return r ? mapRow(r) : null
  }

  const toPublic = (row: HostActionRow): HostActionPublicView => ({
    actionId: row.actionId,
    sessionId: row.sessionId,
    state: row.state,
    version: row.version,
    replayPolicy: row.replayPolicy,
    deadline: row.deadline,
    createdAt: row.createdAt,
  })

  const toTerminal = (row: HostActionRow): HostActionTerminalResult => {
    if (row.state === 'succeeded') {
      return {
        actionId: row.actionId,
        state: 'succeeded',
        result: row.resultJson ? JSON.parse(row.resultJson) : undefined,
      }
    }
    if (row.state === 'failed') {
      return {
        actionId: row.actionId,
        state: 'failed',
        error: row.errorJson ? JSON.parse(row.errorJson) : undefined,
      }
    }
    return {
      actionId: row.actionId,
      state: 'cancelled',
      error: row.errorJson ? JSON.parse(row.errorJson) : { code: 'cancelled' },
    }
  }

  const store: HostActionStore = {
    create(input) {
      const now = input.now ?? Date.now()
      const deadlineMs = input.deadlineMs ?? DEFAULT_HOST_ACTION_DEADLINE_MS
      const row: HostActionRow = {
        actionId: randomUUID(),
        sessionId: input.sessionId,
        turnId: input.turnId ?? null,
        controllerClientSessionId: input.controllerClientSessionId,
        toolName: input.toolName,
        toolGroup: input.toolGroup,
        argsJson: JSON.stringify(input.args ?? null),
        replayPolicy: input.replayPolicy,
        state: 'pending',
        version: 1,
        createdAt: now,
        deadline: now + deadlineMs,
        claimTokenHash: null,
        claimedAt: null,
        claimExpiresAt: null,
        resultJson: null,
        errorJson: null,
        responsePayloadHash: null,
        finishedAt: null,
      }

      // Row + change sequence in one transaction.
      db.prepare('BEGIN IMMEDIATE').run()
      try {
        db.prepare(
          `INSERT INTO host_actions
           (action_id, session_id, turn_id, controller_client_session_id, tool_name, tool_group,
            args_json, replay_policy, state, version, created_at, deadline,
            claim_token_hash, claimed_at, claim_expires_at, result_json, error_json,
            response_payload_hash, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.actionId,
          row.sessionId,
          row.turnId,
          row.controllerClientSessionId,
          row.toolName,
          row.toolGroup,
          row.argsJson,
          row.replayPolicy,
          row.state,
          row.version,
          row.createdAt,
          row.deadline,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        )
        insertChange(row, now)
        db.prepare('COMMIT').run()
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
      return row
    },

    get(actionId) {
      return load(actionId)
    },

    listOutstanding(controllerClientSessionId) {
      const rows = db
        .prepare(
          `SELECT action_id, session_id, turn_id, controller_client_session_id, tool_name, tool_group,
                  args_json, replay_policy, state, version, created_at, deadline,
                  claim_token_hash, claimed_at, claim_expires_at, result_json, error_json,
                  response_payload_hash, finished_at
           FROM host_actions
           WHERE controller_client_session_id = ?
             AND state IN ('pending', 'claimed')
           ORDER BY created_at ASC`,
        )
        .all(controllerClientSessionId) as Array<Parameters<typeof mapRow>[0]>
      return rows.map((r) => toPublic(mapRow(r)))
    },

    listChangesAfter(controllerClientSessionId, afterSequence, limit) {
      const after = Number(afterSequence || '0')
      const rows = db
        .prepare(
          `SELECT sequence, action_id, session_id, state, version, replay_policy, changed_at
           FROM host_action_changes
           WHERE controller_client_session_id = ?
             AND sequence > ?
           ORDER BY sequence ASC
           LIMIT ?`,
        )
        .all(controllerClientSessionId, after, limit) as Array<{
        sequence: number
        action_id: string
        session_id: string
        state: string
        version: number
        replay_policy: string
        changed_at: number
      }>
      return rows.map((r) => ({
        sequence: String(r.sequence),
        actionId: r.action_id,
        sessionId: r.session_id,
        state: r.state as HostActionState,
        version: r.version,
        replayPolicy: r.replay_policy as HostActionReplayPolicy,
        changedAt: r.changed_at,
      }))
    },

    headSequence() {
      const row = db.prepare(`SELECT MAX(sequence) AS m FROM host_action_changes`).get() as {
        m: number | null
      }
      return String(row.m ?? 0)
    },

    claim(input) {
      const now = input.now ?? Date.now()
      const claimTtlMs = input.claimTtlMs ?? DEFAULT_HOST_ACTION_CLAIM_TTL_MS
      const claimToken = randomBytes(32).toString('base64url')
      const claimTokenHash = hashToken(claimToken)

      db.prepare('BEGIN IMMEDIATE').run()
      try {
        const row = load(input.actionId)
        if (!row) {
          throw Object.assign(new Error('host action not found'), { code: 'not_found' })
        }
        if (row.controllerClientSessionId !== input.controllerClientSessionId) {
          throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
        }
        if (row.state !== 'pending') {
          throw Object.assign(new Error(`host action is ${row.state}, expected pending`), {
            code: 'failed_precondition',
          })
        }
        if (row.version !== input.expectedVersion) {
          throw Object.assign(new Error('version conflict'), { code: 'conflict' })
        }
        if (row.deadline <= now) {
          throw Object.assign(new Error('host action deadline expired'), {
            code: 'failed_precondition',
          })
        }

        const nextVersion = row.version + 1
        const claimExpiresAt = now + claimTtlMs
        const result = db
          .prepare(
            `UPDATE host_actions SET
               state = 'claimed',
               version = ?,
               claim_token_hash = ?,
               claimed_at = ?,
               claim_expires_at = ?
             WHERE action_id = ? AND state = 'pending' AND version = ?`,
          )
          .run(
            nextVersion,
            claimTokenHash,
            now,
            claimExpiresAt,
            input.actionId,
            input.expectedVersion,
          )
        if (result.changes !== 1) {
          throw Object.assign(new Error('claim lost race'), { code: 'conflict' })
        }
        const updated = load(input.actionId)!
        insertChange(updated, now)
        db.prepare('COMMIT').run()
        return { row: updated, claimToken }
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
    },

    respond(input) {
      const hash = payloadHash(input.outcome, input.result, input.error)
      const tokenHash = hashToken(input.claimToken)

      db.prepare('BEGIN IMMEDIATE').run()
      try {
        const row = load(input.actionId)
        if (!row) {
          throw Object.assign(new Error('host action not found'), { code: 'not_found' })
        }
        if (row.controllerClientSessionId !== input.controllerClientSessionId) {
          throw Object.assign(new Error('not the session controller'), { code: 'forbidden' })
        }

        // Terminal compare-and-set: identical response is a durable receipt; different is conflict.
        if (isTerminal(row.state) && (row.state === 'succeeded' || row.state === 'failed')) {
          if (row.responsePayloadHash && tokensEqual(row.responsePayloadHash, hash)) {
            db.prepare('COMMIT').run()
            return { row, duplicate: true }
          }
          throw Object.assign(new Error('conflicting host action response'), {
            code: 'conflict',
          })
        }

        if (row.state === 'cancelled') {
          throw Object.assign(new Error('host action already cancelled'), {
            code: 'failed_precondition',
          })
        }
        if (row.state !== 'claimed') {
          throw Object.assign(new Error(`host action is ${row.state}, expected claimed`), {
            code: 'failed_precondition',
          })
        }
        if (!row.claimTokenHash || !tokensEqual(row.claimTokenHash, tokenHash)) {
          throw Object.assign(new Error('invalid claim token'), { code: 'forbidden' })
        }

        const now = Date.now()
        const nextState = input.outcome
        const nextVersion = row.version + 1
        const resultJson =
          input.outcome === 'succeeded' ? JSON.stringify(input.result ?? null) : null
        const errorJson =
          input.outcome === 'failed' ? JSON.stringify(input.error ?? null) : null

        const result = db
          .prepare(
            `UPDATE host_actions SET
               state = ?,
               version = ?,
               result_json = ?,
               error_json = ?,
               response_payload_hash = ?,
               finished_at = ?,
               claim_token_hash = NULL,
               claim_expires_at = NULL
             WHERE action_id = ? AND state = 'claimed' AND version = ?`,
          )
          .run(
            nextState,
            nextVersion,
            resultJson,
            errorJson,
            hash,
            now,
            input.actionId,
            row.version,
          )
        if (result.changes !== 1) {
          throw Object.assign(new Error('respond lost race'), { code: 'conflict' })
        }
        const updated = load(input.actionId)!
        insertChange(updated, now)
        db.prepare('COMMIT').run()
        return { row: updated, duplicate: false }
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
    },

    cancel(input) {
      const now = input.now ?? Date.now()
      const cancelled: HostActionRow[] = []
      db.prepare('BEGIN IMMEDIATE').run()
      try {
        let rows: HostActionRow[] = []
        if (input.actionId) {
          const row = load(input.actionId)
          if (row) rows = [row]
        } else if (input.sessionId) {
          const raw = db
            .prepare(
              `SELECT action_id, session_id, turn_id, controller_client_session_id, tool_name, tool_group,
                      args_json, replay_policy, state, version, created_at, deadline,
                      claim_token_hash, claimed_at, claim_expires_at, result_json, error_json,
                      response_payload_hash, finished_at
               FROM host_actions
               WHERE session_id = ? AND state IN ('pending', 'claimed')`,
            )
            .all(input.sessionId) as Array<Parameters<typeof mapRow>[0]>
          rows = raw.map(mapRow)
        }

        for (const row of rows) {
          if (isTerminal(row.state)) continue
          const nextVersion = row.version + 1
          const errorJson = JSON.stringify({ code: 'cancelled', reason: input.reason })
          const result = db
            .prepare(
              `UPDATE host_actions SET
                 state = 'cancelled',
                 version = ?,
                 error_json = ?,
                 finished_at = ?,
                 claim_token_hash = NULL,
                 claim_expires_at = NULL
               WHERE action_id = ? AND state IN ('pending', 'claimed') AND version = ?`,
            )
            .run(nextVersion, errorJson, now, row.actionId, row.version)
          if (result.changes !== 1) continue
          const updated = load(row.actionId)!
          insertChange(updated, now)
          cancelled.push(updated)
        }
        db.prepare('COMMIT').run()
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
      return cancelled
    },

    reconcileExpired(nowInput) {
      const now = nowInput ?? Date.now()
      const changed: HostActionRow[] = []
      db.prepare('BEGIN IMMEDIATE').run()
      try {
        const raw = db
          .prepare(
            `SELECT action_id, session_id, turn_id, controller_client_session_id, tool_name, tool_group,
                    args_json, replay_policy, state, version, created_at, deadline,
                    claim_token_hash, claimed_at, claim_expires_at, result_json, error_json,
                    response_payload_hash, finished_at
             FROM host_actions
             WHERE state IN ('pending', 'claimed')`,
          )
          .all() as Array<Parameters<typeof mapRow>[0]>

        for (const r of raw) {
          const row = mapRow(r)
          // Deadline expiry cancels any non-terminal action.
          if (row.deadline <= now) {
            const nextVersion = row.version + 1
            const errorJson = JSON.stringify({ code: 'deadline_exceeded' })
            const result = db
              .prepare(
                `UPDATE host_actions SET
                   state = 'cancelled', version = ?, error_json = ?, finished_at = ?,
                   claim_token_hash = NULL, claim_expires_at = NULL
                 WHERE action_id = ? AND version = ? AND state IN ('pending', 'claimed')`,
              )
              .run(nextVersion, errorJson, now, row.actionId, row.version)
            if (result.changes === 1) {
              const updated = load(row.actionId)!
              insertChange(updated, now)
              changed.push(updated)
            }
            continue
          }

          // Claim TTL: requeue only for replay-safe; cancel unsafe.
          if (
            row.state === 'claimed' &&
            row.claimExpiresAt != null &&
            row.claimExpiresAt <= now
          ) {
            if (row.replayPolicy === 'safe') {
              const nextVersion = row.version + 1
              const result = db
                .prepare(
                  `UPDATE host_actions SET
                     state = 'pending', version = ?,
                     claim_token_hash = NULL, claimed_at = NULL, claim_expires_at = NULL
                   WHERE action_id = ? AND version = ? AND state = 'claimed'`,
                )
                .run(nextVersion, row.actionId, row.version)
              if (result.changes === 1) {
                const updated = load(row.actionId)!
                insertChange(updated, now)
                changed.push(updated)
              }
            } else {
              // Fail closed for unsafe: never requeue to pending without indeterminate.
              const nextVersion = row.version + 1
              const errorJson = JSON.stringify({
                code: 'claim_expired',
                reason: 'unsafe_claim_expired_no_requeue',
              })
              const result = db
                .prepare(
                  `UPDATE host_actions SET
                     state = 'cancelled', version = ?, error_json = ?, finished_at = ?,
                     claim_token_hash = NULL, claim_expires_at = NULL
                   WHERE action_id = ? AND version = ? AND state = 'claimed'`,
                )
                .run(nextVersion, errorJson, now, row.actionId, row.version)
              if (result.changes === 1) {
                const updated = load(row.actionId)!
                insertChange(updated, now)
                changed.push(updated)
              }
            }
          }
        }
        db.prepare('COMMIT').run()
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
      return changed
    },

    reconcileAfterRestart(nowInput) {
      const now = nowInput ?? Date.now()
      const cancelled: HostActionRow[] = []
      db.prepare('BEGIN IMMEDIATE').run()
      try {
        const raw = db
          .prepare(`SELECT action_id FROM host_actions WHERE state IN ('pending', 'claimed')`)
          .all() as Array<{ action_id: string }>
        for (const { action_id } of raw) {
          const row = load(action_id)
          if (!row || isTerminal(row.state)) continue
          const nextVersion = row.version + 1
          const errorJson = JSON.stringify({
            code: 'cancelled',
            reason: 'node_restart',
          })
          const result = db
            .prepare(
              `UPDATE host_actions SET
                 state = 'cancelled', version = ?, error_json = ?, finished_at = ?,
                 claim_token_hash = NULL, claim_expires_at = NULL
               WHERE action_id = ? AND version = ? AND state IN ('pending', 'claimed')`,
            )
            .run(nextVersion, errorJson, now, row.actionId, row.version)
          if (result.changes === 1) {
            const updated = load(row.actionId)!
            insertChange(updated, now)
            cancelled.push(updated)
          }
        }
        db.prepare('COMMIT').run()
      } catch (err) {
        try {
          db.prepare('ROLLBACK').run()
        } catch {
          /* ignore */
        }
        throw err
      }
      return cancelled
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    toPublic,
    toTerminal,
  }

  return store
}
