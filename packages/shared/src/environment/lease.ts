import type { SessionRef, TerminalRef } from './refs'

/**
 * Fenced control leases for interactive Session and writable terminal control.
 * Only one live control lease exists per resource; observers never acquire one.
 */

export interface ControlLease {
  leaseId: string
  resource: SessionRef | TerminalRef
  holderClientId: string
  /** Increments on administrative takeover; commands must match current generation. */
  generation: string
  expiresAt: string
}

export interface LeaseAcquireInput {
  resource: SessionRef | TerminalRef
  /** Requested TTL in ms; node may clamp. */
  ttlMs?: number
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
