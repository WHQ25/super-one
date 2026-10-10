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
  /** Durable or streaming, as the payload decides (see `streamingEventKey`). */
  appendSession(input: {
    sessionId: string
    eventType: string
    payload: unknown
    causationRequestId?: string
    eventVersion?: number
  }): unknown
  readonly epoch: string
  headSequence(): string
  listAfter(afterSequence: string, limit?: number): EnvironmentEventEnvelope[]
  streamingAfter(sessionId: string, version: number): EnvironmentEventEnvelope[] | null
  streaming(): EnvironmentEventEnvelope[]
  /** Called after each committed event (push streams forward it). */
  onAppend(listener: (envelope: EnvironmentEventEnvelope) => void): () => void
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
