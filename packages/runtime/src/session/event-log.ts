import { randomUUID } from 'node:crypto'
import type {
  EnvironmentAggregateType,
  EnvironmentEventEnvelope,
  SessionDurableEventType,
} from '@superone/shared/environment'
import type { SqliteDatabase } from '../sqlite'

export class EventLog {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly environmentId: string,
  ) {}

  append(input: {
    aggregateType: EnvironmentAggregateType
    aggregateId: string
    eventType: string
    payload: unknown
    causationRequestId?: string
    eventVersion?: number
  }): EnvironmentEventEnvelope {
    const eventId = randomUUID()
    const timestamp = Date.now()
    const eventVersion = input.eventVersion ?? 1
    const payloadJson = JSON.stringify(input.payload)

    let sequence = '0'
    try {
      const result = this.db
        .prepare(
          `INSERT INTO environment_events
           (event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version, payload_json, causation_request_id, environment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          timestamp,
          input.aggregateType,
          input.aggregateId,
          input.eventType,
          eventVersion,
          payloadJson,
          input.causationRequestId ?? null,
          this.environmentId,
        )
      sequence = String(result.lastInsertRowid)
    } catch (err) {
      if ((err as Error).message?.includes('not open')) {
        return {
          eventId,
          sequence: '0',
          timestamp,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          eventType: input.eventType,
          eventVersion,
          payload: input.payload,
          causationRequestId: input.causationRequestId,
          environmentId: this.environmentId,
        }
      }
      throw err
    }

    return {
      eventId,
      sequence,
      timestamp,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion,
      payload: input.payload,
      causationRequestId: input.causationRequestId,
      environmentId: this.environmentId,
    }
  }

  /**
   * Append a typed durable Session event (Stage 5-A).
   * Convenience over {@link append} with aggregateType fixed to `session`.
   */
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

  /** Latest sequence as decimal string, or "0" if empty. */
  headSequence(): string {
    const row = this.db.prepare(`SELECT MAX(sequence) AS m FROM environment_events`).get() as {
      m: number | null
    }
    return String(row.m ?? 0)
  }

  listAfter(afterSequence: string, limit = 1000): EnvironmentEventEnvelope[] {
    const after = Number(afterSequence || '0')
    const rows = this.db
      .prepare(
        `SELECT sequence, event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version,
                payload_json, causation_request_id, environment_id
         FROM environment_events
         WHERE sequence > ?
         ORDER BY sequence ASC
         LIMIT ?`,
      )
      .all(after, limit) as Array<{
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
    }>

    return rows.map((r) => this.rowToEnvelope(r))
  }

  /**
   * Session-scoped durable events in sequence order (for message catalog expansion).
   * Unbounded by default so hydrate can rebuild full tool summaries; callers
   * should only use this for catalog projection, not live poll.
   */
  listForSession(sessionId: string, limit = 50_000): EnvironmentEventEnvelope[] {
    const sid = String(sessionId ?? '').trim()
    if (!sid) return []
    const rows = this.db
      .prepare(
        `SELECT sequence, event_id, timestamp, aggregate_type, aggregate_id, event_type, event_version,
                payload_json, causation_request_id, environment_id
         FROM environment_events
         WHERE aggregate_type = 'session' AND aggregate_id = ?
         ORDER BY sequence ASC
         LIMIT ?`,
      )
      .all(sid, limit) as Array<{
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
    }>

    return rows.map((r) => this.rowToEnvelope(r))
  }

  private rowToEnvelope(r: {
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
  }): EnvironmentEventEnvelope {
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
    }
  }
}
