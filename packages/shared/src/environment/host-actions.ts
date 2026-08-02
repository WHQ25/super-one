/**
 * Host Action channel wire contracts.
 *
 * Transport substrate for actions that must execute on the controlling desktop
 * (browser automation, computer use). Args never appear in the general
 * `session.events` log — only on successful claim, and only to the controller.
 */

/** Capability version stamped on session.create for this channel. */
export const HOST_ACTION_CAPABILITY_VERSION = 1 as const

/**
 * Session-scoped tool groups a controller may execute.
 * First grant is browser.read (read-only browser surface).
 */
export const HOST_ACTION_TOOL_GROUPS = {
  browserRead: 'browser.read',
} as const

export type HostActionToolGroup =
  (typeof HOST_ACTION_TOOL_GROUPS)[keyof typeof HOST_ACTION_TOOL_GROUPS]

/**
 * Replay policy for claim-expiry requeue.
 *
 * - `safe`: claimed actions may return to `pending` after claim TTL / disconnect
 * - `unsafe`: never requeue; claim expiry cancels (indeterminate is deferred —
 *   do not ship non-replayable tools until an `indeterminate` terminal state
 *   exists, and never transition a claimed non-replayable action back to pending)
 */
export type HostActionReplayPolicy = 'safe' | 'unsafe'

export type HostActionState =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** Public poll/snapshot surface — never includes args. */
export interface HostActionPublicView {
  actionId: string
  sessionId: string
  state: HostActionState
  version: number
  replayPolicy: HostActionReplayPolicy
  /** Wall-clock deadline for the action (ms since epoch). */
  deadline: number
  createdAt: number
}

/** Durable change notification (poll after cursor). */
export interface HostActionChange {
  sequence: string
  actionId: string
  sessionId: string
  state: HostActionState
  version: number
  replayPolicy: HostActionReplayPolicy
  changedAt: number
}

export interface HostActionsPollInput {
  /** Exclusive sequence cursor. Omit / null for outstanding snapshot. */
  afterSequence?: string | null
  /** Long-poll wait when afterSequence is set and no changes yet (ms). */
  waitMs?: number
  limit?: number
}

export interface HostActionsPollResult {
  /** Present when afterSequence was omitted — full outstanding view for this controller. */
  outstanding?: HostActionPublicView[]
  changes: HostActionChange[]
  /** Current head sequence (use as next afterSequence). */
  cursor: string
}

export interface ClaimHostActionInput {
  actionId: string
  /** Optimistic concurrency — must match current row version. */
  expectedVersion: number
}

export interface ClaimHostActionResult {
  actionId: string
  version: number
  claimToken: string
  claimExpiresAt: number
  toolName: string
  toolGroup: string
  args: unknown
  replayPolicy: HostActionReplayPolicy
  sessionId: string
  turnId: string | null
}

export type HostActionOutcome = 'succeeded' | 'failed'

export interface RespondHostActionInput {
  actionId: string
  claimToken: string
  outcome: HostActionOutcome
  result?: unknown
  error?: unknown
}

export interface RespondHostActionResult {
  actionId: string
  state: 'succeeded' | 'failed'
  version: number
  /** True when this call replayed a stored identical terminal receipt. */
  duplicate: boolean
}

/** Runtime-side await result for requestHostAction. */
export interface HostActionTerminalResult {
  actionId: string
  state: 'succeeded' | 'failed' | 'cancelled'
  result?: unknown
  error?: unknown
}
