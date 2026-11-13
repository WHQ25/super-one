/**
 * Shrink `environment_events` without dropping anything a client still needs.
 *
 * Below each session's read-model checkpoint, streaming-tier rows and superseded
 * catalog or usage snapshots are redundant: the checkpoint already holds the
 * messages. Sessions that are streaming, or waiting on a permission, question,
 * or plan, are left alone. A removed session with no row left is deleted whole.
 *
 * Deletes punch holes in the global sequence, so the retention floor is the
 * highest deleted sequence. A cursor below it must resnapshot (`cursor_too_old`)
 * rather than replay a gap. The floor only moves forward.
 */

import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { NodeDatabase } from '../db/database'
import { getMeta, setMeta } from '../db/database'
import { EVENT_RETENTION_FLOOR_KEY } from './event-log'

export { EVENT_RETENTION_FLOOR_KEY }
export const EVENT_COMPACT_AT_KEY = 'event_compact_at'
export const EVENT_COMPACT_FREED_KEY = 'event_compact_freed_bytes'
/** Automatic compaction waits until the node database (plus its WAL) is at least this large. */
export const EVENT_LOG_COMPACT_MIN_BYTES = 512 * 1024 * 1024

const SPACE_HEADROOM = 1.1

export interface NodeEventStats {
  rows: number
  retentionFloor: string
  lastCompactAt: number | null
  lastFreedBytes: number | null
}

export interface EventLogCompactResult {
  removedRows: number
  /** Payload bytes removed. The file shrinks only when `vacuum` is `done`. */
  freedBytes: number
  floor: string
  vacuum: 'done' | 'skipped' | 'not-requested'
}

export interface EventLogCompactOptions {
  vacuum?: boolean
  filePath?: string
  busySessionIds?: readonly string[]
  externalSessionIds?: readonly string[]
  retainWindowMs?: number
  freeBytes?: number
  now?: number
}

const STREAMING_SQL = `
  e.event_type IN ('session.assistant_delta', 'session.tool_input_delta')
  OR (
    e.event_type = 'session.agent_event'
    AND (
      json_extract(e.payload_json, '$.event.type') IN ('tool_input_delta', 'tool_progress')
      OR (
        json_extract(e.payload_json, '$.event.type') = 'content_delta'
        AND (
          json_extract(e.payload_json, '$.event.delta.type') IN ('text', 'thinking')
          OR (
            json_extract(e.payload_json, '$.event.delta.type') = 'tool_use'
            AND json_type(e.payload_json, '$.event.delta.outputDelta') IS NOT NULL
          )
        )
      )
    )
  )
`

export function readNodeEventStats(db: NodeDatabase): NodeEventStats {
  const rows = db.prepare('SELECT COUNT(*) AS n FROM environment_events').get() as { n: number }
  const at = getMeta(db, EVENT_COMPACT_AT_KEY)
  const freed = getMeta(db, EVENT_COMPACT_FREED_KEY)
  return {
    rows: rows.n,
    retentionFloor: retentionFloor(db),
    lastCompactAt: at !== null && /^\d+$/.test(at) ? Number(at) : null,
    lastFreedBytes: freed !== null && /^\d+$/.test(freed) ? Number(freed) : null,
  }
}

export function compactEnvironmentEvents(db: NodeDatabase, options: EventLogCompactOptions = {}): EventLogCompactResult {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS compact_busy (session_id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS compact_known (session_id TEXT PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS compact_keep (sequence INTEGER PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS compact_doomed (sequence INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);
  `)
  const clearBusy = db.prepare('DELETE FROM compact_busy')
  const clearKnown = db.prepare('DELETE FROM compact_known')
  const clearKeep = db.prepare('DELETE FROM compact_keep')
  const clearDoomed = db.prepare('DELETE FROM compact_doomed')
  const markBusy = db.prepare('INSERT OR IGNORE INTO compact_busy (session_id) VALUES (?)')
  const markKnown = db.prepare('INSERT OR IGNORE INTO compact_known (session_id) VALUES (?)')
  const summarySql = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes, MAX(sequence) AS maxSeq FROM compact_doomed')
  const deleteDoomed = db.prepare('DELETE FROM environment_events WHERE sequence IN (SELECT sequence FROM compact_doomed)')
  const nowMs = options.now ?? Date.now()

  const summary = db.transaction(() => {
    clearBusy.run()
    clearKnown.run()
    clearKeep.run()
    clearDoomed.run()
    const busyRows = db.prepare(
      `SELECT session_id AS id FROM sessions
       WHERE status = 'streaming'
          OR (pending_interaction_json IS NOT NULL
              AND pending_interaction_json != ''
              AND pending_interaction_json != 'null')`,
    ).all() as { id: string }[]
    for (const row of busyRows) markBusy.run(row.id)
    for (const id of options.busySessionIds ?? []) {
      if (id) markBusy.run(id)
    }

    if (options.externalSessionIds !== undefined) {
      for (const id of options.externalSessionIds) {
        if (id) markKnown.run(id)
      }
      compactExternalSessionEvents(db, nowMs, options.retainWindowMs)
    } else {
      compactNodeSessionEvents(db)
    }

    const counted = summarySql.get() as { n: number; bytes: number; maxSeq: number | null }
    if (counted.n > 0) deleteDoomed.run()
    const previous = retentionFloor(db)
    const floor = counted.maxSeq !== null && BigInt(counted.maxSeq) > BigInt(previous)
      ? String(counted.maxSeq)
      : previous
    setMeta(db, EVENT_RETENTION_FLOOR_KEY, floor)
    setMeta(db, EVENT_COMPACT_AT_KEY, String(nowMs))
    setMeta(db, EVENT_COMPACT_FREED_KEY, String(counted.bytes))
    return { removedRows: counted.n, freedBytes: counted.bytes, floor }
  })()

  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    void 0
  }

  return { ...summary, vacuum: vacuumIfRequested(db, options) }
}

function compactNodeSessionEvents(db: NodeDatabase): void {
  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT e.sequence, LENGTH(e.payload_json)
     FROM environment_events e
     WHERE e.aggregate_type = 'session'
       AND e.aggregate_id NOT IN (SELECT session_id FROM sessions)
       AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
       AND EXISTS (
         SELECT 1 FROM environment_events r
         WHERE r.aggregate_type = 'session'
           AND r.aggregate_id = e.aggregate_id
           AND r.event_type = 'session.removed'
       )`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT e.sequence, LENGTH(e.payload_json)
     FROM environment_events e
     JOIN session_read_models m ON m.session_id = e.aggregate_id
     WHERE e.aggregate_type = 'session'
       AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
       AND COALESCE(e.session_version, e.sequence) <= m.applied_version
       AND (${STREAMING_SQL})`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT sequence, bytes FROM (
       SELECT e.sequence AS sequence,
              LENGTH(e.payload_json) AS bytes,
              ROW_NUMBER() OVER (
                PARTITION BY e.aggregate_id, json_extract(e.payload_json, '$.event.type')
                ORDER BY e.sequence DESC
              ) AS rn
       FROM environment_events e
       JOIN session_read_models m ON m.session_id = e.aggregate_id
       WHERE e.aggregate_type = 'session'
         AND e.event_type = 'session.agent_event'
         AND json_extract(e.payload_json, '$.event.type') IN ('acp_commands', 'session_commands', 'session_capabilities')
         AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
         AND COALESCE(e.session_version, e.sequence) <= m.applied_version
     ) WHERE rn > 1`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT sequence, bytes FROM (
       SELECT e.sequence AS sequence,
              LENGTH(e.payload_json) AS bytes,
              ROW_NUMBER() OVER (
                PARTITION BY e.aggregate_id, IFNULL(json_extract(e.payload_json, '$.event.messageId'), '')
                ORDER BY e.sequence DESC
              ) AS rn
       FROM environment_events e
       JOIN session_read_models m ON m.session_id = e.aggregate_id
       WHERE e.aggregate_type = 'session'
         AND e.event_type = 'session.agent_event'
         AND json_extract(e.payload_json, '$.event.type') = 'message_usage'
         AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
         AND COALESCE(e.session_version, e.sequence) <= m.applied_version
     ) WHERE rn > 1`,
  ).run()
}

function compactExternalSessionEvents(db: NodeDatabase, nowMs: number, retainWindowMs?: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT e.sequence, LENGTH(e.payload_json)
     FROM environment_events e
     WHERE e.aggregate_type = 'session'
       AND e.aggregate_id NOT IN (SELECT session_id FROM compact_known)
       AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_keep (sequence)
     SELECT MAX(e.sequence)
     FROM environment_events e
     JOIN compact_known k ON k.session_id = e.aggregate_id
     WHERE e.aggregate_type = 'session'
     GROUP BY e.aggregate_id`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_keep (sequence)
     SELECT MAX(e.sequence)
     FROM environment_events e
     JOIN compact_known k ON k.session_id = e.aggregate_id
     WHERE e.aggregate_type = 'session'
       AND (
         e.event_type = 'session.reconciled'
         OR (e.event_type = 'session.agent_event' AND json_extract(e.payload_json, '$.event.type') = 'status_change')
       )
     GROUP BY e.aggregate_id`,
  ).run()

  if (retainWindowMs !== undefined) {
    const cutoff = nowMs - Math.max(0, retainWindowMs)
    db.prepare(
      `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
       SELECT e.sequence, LENGTH(e.payload_json)
       FROM environment_events e
       WHERE (
         (
           e.aggregate_type = 'session'
           AND e.aggregate_id IN (SELECT session_id FROM compact_known)
           AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
           AND e.sequence NOT IN (SELECT sequence FROM compact_keep)
           AND e.timestamp < ?
         )
         OR (
           e.aggregate_type != 'session'
           AND e.timestamp < ?
         )
       )`,
    ).run(cutoff, cutoff)
  }

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT e.sequence, LENGTH(e.payload_json)
     FROM environment_events e
     WHERE e.aggregate_type = 'session'
       AND e.aggregate_id IN (SELECT session_id FROM compact_known)
       AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
       AND e.sequence NOT IN (SELECT sequence FROM compact_keep)
       AND (${STREAMING_SQL})`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT sequence, bytes FROM (
       SELECT e.sequence AS sequence,
              LENGTH(e.payload_json) AS bytes,
              ROW_NUMBER() OVER (
                PARTITION BY e.aggregate_id, json_extract(e.payload_json, '$.event.type')
                ORDER BY e.sequence DESC
              ) AS rn
       FROM environment_events e
       WHERE e.aggregate_type = 'session'
         AND e.event_type = 'session.agent_event'
         AND json_extract(e.payload_json, '$.event.type') IN ('acp_commands', 'session_commands', 'session_capabilities')
         AND e.aggregate_id IN (SELECT session_id FROM compact_known)
         AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
     ) WHERE rn > 1 AND sequence NOT IN (SELECT sequence FROM compact_keep)`,
  ).run()

  db.prepare(
    `INSERT OR IGNORE INTO compact_doomed (sequence, bytes)
     SELECT sequence, bytes FROM (
       SELECT e.sequence AS sequence,
              LENGTH(e.payload_json) AS bytes,
              ROW_NUMBER() OVER (
                PARTITION BY e.aggregate_id, IFNULL(json_extract(e.payload_json, '$.event.messageId'), '')
                ORDER BY e.sequence DESC
              ) AS rn
       FROM environment_events e
       WHERE e.aggregate_type = 'session'
         AND e.event_type = 'session.agent_event'
         AND json_extract(e.payload_json, '$.event.type') = 'message_usage'
         AND e.aggregate_id IN (SELECT session_id FROM compact_known)
         AND e.aggregate_id NOT IN (SELECT session_id FROM compact_busy)
     ) WHERE rn > 1 AND sequence NOT IN (SELECT sequence FROM compact_keep)`,
  ).run()
}

function retentionFloor(db: NodeDatabase): string {
  const value = getMeta(db, EVENT_RETENTION_FLOOR_KEY)
  return value !== null && /^\d+$/.test(value) ? value : '0'
}

function vacuumIfRequested(db: NodeDatabase, options: EventLogCompactOptions): EventLogCompactResult['vacuum'] {
  if (!options.vacuum) return 'not-requested'
  const filePath = options.filePath
  if (!filePath || filePath === ':memory:') return 'skipped'
  let size = 0
  try {
    size = statSync(filePath).size
  } catch {
    return 'skipped'
  }
  const mode = Number(db.pragma('auto_vacuum', { simple: true }))
  if (mode === 2) {
    db.pragma('incremental_vacuum')
    return 'done'
  }
  const free = options.freeBytes ?? freeBytesOf(filePath)
  if (free < Math.ceil(size * SPACE_HEADROOM)) return 'skipped'
  db.exec('VACUUM')
  return 'done'
}

function freeBytesOf(filePath: string): number {
  try {
    const stats = statfsSync(dirname(filePath))
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return 0
  }
}
