import { randomUUID } from 'node:crypto'
import {
  committedStreamingMessage,
  streamingEventKey,
  type EnvironmentAggregateType,
  type EnvironmentEventEnvelope,
  type SessionDurableEventType,
} from '@superone/shared/environment'
import type { TransactionalSqliteDatabase } from '../sqlite'
import { StreamingRing } from './streaming-ring'

type EventRow = {
  sequence: number
  event_id: string
  timestamp: number
  aggregate_type: EnvironmentAggregateType
  aggregate_id: string
  event_type: string
  event_version: number
  payload_json: string
  causation_request_id: string | null
  environment_id: string
  session_version: number | null
}

const ROW_COLUMNS = `sequence, event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version,
  payload_json, causation_request_id, environment_id, session_version`

/**
 * One node's session log: durable events in SQLite, streaming events (text
 * deltas and the like, see `streamingEventKey`) in a ring that holds them only
 * while their message streams. Every session event gets the session's next
 * version. An applier (the read model) sees each event first — a durable one
 * inside the transaction that stores it — and only then do listeners hear of
 * it, so nothing is published before it is committed.
 */
export class EventLog {
  /** This process's epoch: versions of streaming events are only meaningful within it. */
  readonly epoch = randomUUID()
  private readonly appendListeners = new Set<(envelope: EnvironmentEventEnvelope) => void>()
  private readonly versions = new Map<string, number>()
  private readonly ring = new StreamingRing()
  private applier: ((envelope: EnvironmentEventEnvelope) => void) | null = null
  private lastSequence: string | null = null

  constructor(
    private readonly db: TransactionalSqliteDatabase,
    private readonly environmentId: string,
  ) {}

  /** Called after each committed event, durable or streaming. */
  onAppend(listener: (envelope: EnvironmentEventEnvelope) => void): () => void {
    this.appendListeners.add(listener)
    return () => { this.appendListeners.delete(listener) }
  }

  /** The read model: applied to every event before it is published. */
  setApplier(apply: (envelope: EnvironmentEventEnvelope) => void): void {
    this.applier = apply
  }

  append(input: {
    aggregateType: EnvironmentAggregateType
    aggregateId: string
    eventType: string
    payload: unknown
    causationRequestId?: string
    eventVersion?: number
  }): EnvironmentEventEnvelope {
    const isSession = input.aggregateType === 'session'
    const streaming = isSession ? streamingEventKey(input.eventType, input.payload) : null
    const envelope: EnvironmentEventEnvelope = {
      eventId: randomUUID(),
      sequence: '0',
      timestamp: Date.now(),
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      payload: input.payload,
      causationRequestId: input.causationRequestId,
      environmentId: this.environmentId,
    }

    if (streaming) {
      envelope.sequence = this.headSequence()
      envelope.sessionVersion = this.nextVersion(input.aggregateId)
      envelope.ephemeral = true
      this.ring.add(envelope, streaming)
      this.applier?.(envelope)
    } else {
      try {
        this.db.transaction(() => {
          if (isSession) envelope.sessionVersion = this.nextVersion(input.aggregateId)
          const result = this.db
            .prepare(
              `INSERT INTO environment_events
               (event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version, payload_json, causation_request_id, environment_id, session_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              envelope.eventId,
              envelope.timestamp,
              envelope.aggregateType,
              envelope.aggregateId,
              envelope.eventType,
              envelope.eventVersion,
              JSON.stringify(input.payload),
              input.causationRequestId ?? null,
              this.environmentId,
              envelope.sessionVersion ?? null,
            )
          envelope.sequence = String(result.lastInsertRowid)
          this.applier?.(envelope)
        })()
      } catch (err) {
        // Appends racing database shutdown are dropped, as before versions.
        if ((err as Error).message?.includes('not open')) return envelope
        throw err
      }
      this.lastSequence = envelope.sequence
      if (isSession) {
        const committed = committedStreamingMessage(input.eventType, input.payload)
        if (committed !== undefined) this.ring.retire(input.aggregateId, committed)
      }
    }
    for (const listener of [...this.appendListeners]) listener(envelope)
    return envelope
  }

  /** Append a session event; whether it is stored or streamed follows from its payload. */
  appendSession(input: {
    sessionId: string
    eventType: SessionDurableEventType | string
    payload: unknown
    causationRequestId?: string
    eventVersion?: number
  }): EnvironmentEventEnvelope {
    return this.append({
      aggregateType: 'session',
      aggregateId: input.sessionId,
      eventType: input.eventType,
      payload: input.payload,
      causationRequestId: input.causationRequestId,
      eventVersion: input.eventVersion,
    })
  }

  headSequence(): string {
    return this.lastSequence ?? this.durableHead()
  }

  syncAfterCompact(knownSessionIds?: ReadonlySet<string>): void {
    this.durableHead()
    if (!knownSessionIds) return
    for (const id of [...this.versions.keys()]) {
      if (!knownSessionIds.has(id)) this.versions.delete(id)
    }
  }

  /** A session's latest version, durable or streaming. */
  sessionVersion(sessionId: string): number {
    let version = this.versions.get(sessionId)
    if (version === undefined) {
      // Rows from before versions read as their sequence; new versions continue above.
      const row = this.db
        .prepare(
          `SELECT MAX(COALESCE(session_version, sequence)) AS v FROM environment_events
           WHERE aggregate_type = 'session' AND aggregate_id = ?`,
        )
        .get(sessionId) as { v: number | null }
      version = row.v ?? 0
      this.versions.set(sessionId, version)
    }
    return version
  }

  /** A session's streaming events above `version`, or null when some are gone. */
  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null {
    return this.ring.after(sessionId, version)
  }

  /** Every streaming event held now. */
  streaming(): EnvironmentEventEnvelope[] {
    return this.ring.all()
  }

  listAfter(afterSequence: string, limit = 1000): EnvironmentEventEnvelope[] {
    const after = /^\d+$/.test(afterSequence) ? afterSequence : '0'
    const floor = retentionFloor(this.db)
    // Equal to the floor is still readable: listAfter is exclusive, so that cursor already has the deleted row.
    if (BigInt(after) < BigInt(floor)) {
      throw Object.assign(new Error('event cursor is older than retained history'), {
        code: 'cursor_too_old' as const,
        details: { snapshotRequired: true, floor, head: this.durableHead() },
      })
    }
    const rows = this.db
      .prepare(`SELECT ${ROW_COLUMNS} FROM environment_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`)
      .all(Number(after), limit) as EventRow[]
    return rows.map((r) => this.rowToEnvelope(r))
  }

  /** Whether a checkpoint needs durable replay, without parsing event bodies. */
  hasSessionEventsAfter(sessionId: string, version: number): boolean {
    return !!this.db.prepare(`SELECT 1 FROM environment_events
      WHERE aggregate_type = 'session' AND aggregate_id = ? AND COALESCE(session_version, sequence) > ? LIMIT 1`).get(sessionId, version)
  }

  /**
   * Session-scoped durable events in sequence order, above `afterVersion` when
   * given (read-model replay); unbounded by default for catalog projection.
   */
  listForSession(sessionId: string, limit = 50_000, afterVersion = 0): EnvironmentEventEnvelope[] {
    const sid = String(sessionId ?? '').trim()
    if (!sid) return []
    const rows = this.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM environment_events
         WHERE aggregate_type = 'session' AND aggregate_id = ? AND COALESCE(session_version, sequence) > ?
         ORDER BY sequence ASC
         LIMIT ?`,
      )
      .all(sid, afterVersion, limit) as EventRow[]
    return rows.map((r) => this.rowToEnvelope(r))
  }

  private durableHead(): string {
    const row = this.db.prepare(`SELECT MAX(sequence) AS m FROM environment_events`).get() as { m: number | null }
    const stored = String(row?.m ?? 0)
    const floor = retentionFloor(this.db)
    const head = BigInt(stored) >= BigInt(floor) ? stored : floor
    this.lastSequence = head
    return head
  }

  private nextVersion(sessionId: string): number {
    const version = this.sessionVersion(sessionId) + 1
    this.versions.set(sessionId, version)
    return version
  }

  private rowToEnvelope(r: EventRow): EnvironmentEventEnvelope {
    return {
      eventId: r.event_id,
      sequence: String(r.sequence),
      timestamp: r.timestamp,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      eventType: r.event_type,
      eventVersion: r.event_version,
      payload: JSON.parse(r.payload_json),
      causationRequestId: r.causation_request_id ?? undefined,
      environmentId: r.environment_id,
      ...(r.aggregate_type === 'session' ? { sessionVersion: r.session_version ?? r.sequence } : {}),
    }
  }
}

export const EVENT_RETENTION_FLOOR_KEY = 'event_retention_floor'

/**
 * A cursor the log can no longer replay. `head` is where a reader resumes after it reloads.
 * Missing meta (a test double) reads as floor 0, which never trips this.
 */
export function cursorTooOldDetails(err: unknown): { floor: string; head: string } | null {
  if (!err || typeof err !== 'object') return null
  const body = err as { code?: unknown; details?: { floor?: unknown; head?: unknown } }
  if (body.code !== 'cursor_too_old') return null
  const head = decimal(body.details?.head)
  if (head === null) return null
  return { floor: decimal(body.details?.floor) ?? '0', head }
}

function retentionFloor(db: { prepare(sql: string): { get(...params: unknown[]): unknown } }): string {
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(EVENT_RETENTION_FLOOR_KEY) as { value?: unknown } | undefined
    return decimal(row?.value) ?? '0'
  } catch {
    return '0'
  }
}

function decimal(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return null
}
