/**
 * Durable environment event log contracts.
 * Sequence is a decimal string on the wire and a SQLite integer internally.
 */

export type EnvironmentAggregateType =
  | 'environment'
  | 'project'
  | 'session'
  | 'terminal'
  | 'interaction'
  | 'workspace'
  | 'access'
  | 'node'

export interface EnvironmentEventEnvelope<T = unknown> {
  eventId: string
  /** Monotonic environment-wide sequence as decimal string. */
  sequence: string
  timestamp: number
  aggregateType: EnvironmentAggregateType
  aggregateId: string
  eventType: string
  eventVersion: number
  payload: T
  /** Causation request ID when the event was produced by an RPC command. */
  causationRequestId?: string
  environmentId: string
}

export interface SubscribeEventsInput {
  environmentId: string
  /**
   * Resume from this sequence exclusive (subscribe from snapshotSequence + 1).
   * Omit or null to require a snapshot first.
   */
  afterSequence?: string | null
  /** Optional aggregate filters. */
  aggregateTypes?: EnvironmentAggregateType[]
  aggregateIds?: string[]
}

export interface EnvironmentSnapshot {
  environmentId: string
  /** Sequence included in this snapshot; subscribe from snapshotSequence + 1. */
  snapshotSequence: string
  capturedAt: number
  /** Opaque phase-specific snapshot body; typed per aggregate in later phases. */
  projects: ProjectSnapshot[]
  sessions: SessionEventSnapshot[]
  terminals: TerminalEventSnapshot[]
  pendingInteractions: PendingInteractionSnapshot[]
}

export interface ProjectSnapshot {
  projectId: string
  /** Absolute path on the environment filesystem. */
  path: string
  name: string
  /** True when the registered path no longer resolves to a directory on its host. */
  missing?: boolean
  /** Stable repository identity when available. */
  repoIdentity?: string | null
  openedAt?: number
  lastActiveAt?: number
}

export interface SessionEventSnapshot {
  sessionId: string
  projectId: string
  status: string
  title: string | null
  providerId: string
  harnessId: string
  updatedAt: number
}

export interface TerminalEventSnapshot {
  terminalId: string
  projectId?: string
  title?: string
  cwd?: string
  updatedAt: number
}

export interface PendingInteractionSnapshot {
  interactionId: string
  sessionId: string
  kind: 'permission' | 'question' | 'plan'
  createdAt: number
  payload: unknown
}

export type SnapshotRequiredError = {
  code: 'cursor_too_old'
  message: string
  snapshotRequired: true
}

export function sequenceToNumber(sequence: string): bigint {
  if (!/^\d+$/.test(sequence)) {
    throw new Error(`invalid event sequence: ${sequence}`)
  }
  return BigInt(sequence)
}

export function compareSequences(a: string, b: string): number {
  const na = sequenceToNumber(a)
  const nb = sequenceToNumber(b)
  if (na < nb) return -1
  if (na > nb) return 1
  return 0
}

export function nextSequence(sequence: string): string {
  return (sequenceToNumber(sequence) + 1n).toString()
}
