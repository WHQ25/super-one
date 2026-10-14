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
  /**
   * The user's explicit Reconnect or Take over: take a session back after its
   * host released it from this client, or from the host's own window using it.
   */
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

/**
 * Who drives a session on the computer it runs on, as another client sees
 * it: that computer's own window, a phone paired with it, or another paired
 * computer. `label` is the phone's or computer's paired name (null for the
 * window, or when it gave none).
 */
export interface SessionControlHolder {
  kind: 'window' | 'phone' | 'controller'
  label: string | null
}

/** `details.reason` of the refusal a client gets while someone else drives the session; `details.holder` names them. */
export const CONTROL_HELD_REASON = 'control_held'

/** The holder a `control_held` refusal names, or null for any other error. */
export function controlHeldBy(err: unknown): SessionControlHolder | null {
  const details = (err as { details?: { reason?: unknown; holder?: SessionControlHolder } } | null)?.details
  return details?.reason === CONTROL_HELD_REASON && details.holder ? details.holder : null
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
