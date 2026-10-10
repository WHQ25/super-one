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
  /**
   * Position within its session, across both tiers: increasing, never reused
   * within an epoch. Rows written before versions existed read as their
   * `sequence`, and new versions continue above it.
   */
  sessionVersion?: number
  /**
   * Streaming tier: kept in memory while its message streams, never stored.
   * `sequence` is then the last durable sequence before it.
   */
  ephemeral?: true
}

/** Where a stream reader stands in one environment's log. */
export interface SessionStreamCursor {
  /** Last durable sequence read. */
  sequence: string
  /** Process epoch the versions belong to; streaming events do not outlive it. */
  epoch: string
  /** Last version read, per session. */
  versions: Record<string, number>
}

export interface SubscribeEventsInput {
  /** Local consumer cancellation; never serialized as an RPC field. */
  signal?: AbortSignal
  environmentId: string
  /**
   * Resume from this sequence exclusive (subscribe from snapshotSequence + 1).
   * Omit or null to require a snapshot first.
   */
  afterSequence?: string | null
  /** Optional aggregate filters. */
  aggregateTypes?: EnvironmentAggregateType[]
  aggregateIds?: string[]
  /**
   * Local only: whether a lost connection is gone for good (blocked, removed),
   * so the stream should end with that error instead of resubscribing.
   */
  shouldStop?: (err: Error) => boolean
  /**
   * Local only: sessions whose missed events are gone after a resubscribe;
   * read their snapshot again (`SessionStreamFrame.resnapshot`).
   */
  onResnapshot?: (sessionIds: string[]) => void
}

/** `session.subscribe`: push the events after `afterSequence`, then every new one. */
export interface SessionSubscribeInput {
  /** Client-chosen; frames may arrive before the RPC result. */
  subscriptionId: string
  afterSequence: string
  /** With `versions`: resume streaming events too, from a cursor of this epoch. */
  epoch?: string
  versions?: Record<string, number>
  aggregateTypes?: EnvironmentAggregateType[]
  aggregateIds?: string[]
}

/** One push of a `session.subscribe` stream. */
export interface SessionStreamFrame {
  /** Last durable sequence scanned, including filtered-out events; the resume cursor. */
  sequence: string
  epoch: string
  events: EnvironmentEventEnvelope[]
  /**
   * Sessions whose missed events are gone (their message committed, the
   * streaming tier was evicted, or the node restarted): read their snapshot
   * again, then apply only events above its version.
   */
  resnapshot?: string[]
}

/** Server → client message carrying a stream frame. */
export interface SessionStreamMessage {
  type: 'stream'
  subscriptionId: string
  frame: SessionStreamFrame
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
  /**
   * Project-level workspace folders, owned by the host's project catalog rather
   * than by any harness config file. Optional: an older node omits it, and the
   * desktop then behaves exactly as it did before the feature existed.
   */
  extraDirs?: string[]
  openedAt?: number
  lastActiveAt?: number
}

/** `git.clone` result. */
export interface ClonedProject extends ProjectSnapshot {
  /** The checkout existed before the call (`ifExists: 'reuse-or-rename'`) and was not cloned now. */
  reused?: boolean
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
  kind: 'permission' | 'question' | 'plan' | 'session_agents_confirm'
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
