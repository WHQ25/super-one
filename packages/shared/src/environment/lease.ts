import type { SessionRef, TerminalRef } from './refs'

/**
 * Fenced control leases for interactive Session and writable terminal control.
 * Only one live control lease exists per resource; observers never acquire one.
 */

export interface ControlLease {
  leaseId: string
  resource: SessionRef | TerminalRef
  holderClientId: string
  /** The holder inside that client (`LeaseAcquireInput.delegate`); empty for the client itself. */
  delegate?: string
  /** Increments on administrative takeover; commands must match current generation. */
  generation: string
  expiresAt: string
}

export interface LeaseAcquireInput {
  resource: SessionRef | TerminalRef
  /** Requested TTL in ms; node may clamp. */
  ttlMs?: number
  /** Take a session back after its host released it from this client (the user's Reconnect). */
  reclaim?: boolean
  /**
   * A holder inside the authenticated client: a device it relays for, such as
   * a phone through a desktop. One client's delegates hold a resource one at
   * a time, like separate clients.
   */
  delegate?: string
  /**
   * The client's own interface, which steps aside: another delegate of the
   * same client takes the lease over instead of being refused.
   */
  yields?: boolean
}

export interface LeaseRenewInput {
  leaseId: string
  generation: string
  ttlMs?: number
}

export interface LeaseReleaseInput {
  leaseId: string
  generation: string
}

export interface MutatingControlContext {
  leaseId: string
  generation: string
}

/** `details.reason` of the refusal a controller gets after the host took its session back. */
export const CONTROL_RELEASED_REASON = 'control_released'

export function isControlReleasedError(err: unknown): boolean {
  return (err as { details?: { reason?: unknown } } | null)?.details?.reason === CONTROL_RELEASED_REASON
}

export function isSessionResource(
  resource: SessionRef | TerminalRef,
): resource is SessionRef {
  return 'sessionId' in resource
}

export function isTerminalResource(
  resource: SessionRef | TerminalRef,
): resource is TerminalRef {
  return 'terminalId' in resource
}
