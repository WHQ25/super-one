import type { EnvironmentEventEnvelope, SessionRef } from '@superone/shared/environment'
import type { NodeSessionRecord } from './types'

/** Host-owned session persistence (SQLite on the node CLI). */
export interface SessionStore {
  loadAll(): NodeSessionRecord[]
  save(session: NodeSessionRecord): void
  delete(sessionId: string): void
}

/** Durable environment event log for session aggregates. */
export interface SessionEventLog {
  appendSession(input: {
    sessionId: string
    eventType: string
    payload: unknown
    causationRequestId?: string
    eventVersion?: number
  }): unknown
  headSequence(): string
  listAfter(afterSequence: string, limit?: number): EnvironmentEventEnvelope[]
  /**
   * Optional session-scoped read for message catalog expansion.
   * When omitted, listMessages falls back to listAfter('0') + filter.
   */
  listForSession?(sessionId: string, limit?: number): EnvironmentEventEnvelope[]
}

/** Control-lease validation for mutating session ops. */
export interface LeaseGuard {
  assertValid(input: {
    resource: SessionRef
    leaseId: string
    generation: string
    holderClientId: string
  }): void
}
