/**
 * Policy for aborting a remote session event drain when transport recovery is
 * no longer possible via the supervisor's normal reconnect path.
 */

import type { SupervisorSnapshot } from '@superone/shared/environment'

export type DrainAbortDecision =
  | { abort: true; reason: string }
  | { abort: false }

/**
 * Empty-catch get/listEvents loops must not spin forever when the supervisor
 * has entered a terminal-ish state (blocked / offline / connection removed).
 * Reconnecting states (backoff, connecting, disconnected) keep waiting.
 */
export function shouldAbortRemoteSessionDrain(
  supervisor: Pick<SupervisorSnapshot, 'state' | 'lastError'> | null | undefined,
  options?: { hasClient?: boolean },
): DrainAbortDecision {
  if (supervisor?.state === 'blocked') {
    return { abort: true, reason: supervisor.lastError || 'connection blocked' }
  }
  if (supervisor?.state === 'offline') {
    return { abort: true, reason: supervisor.lastError || 'network offline' }
  }
  // Unpaired / disposed: no live client and no supervisor snapshot.
  if (!supervisor && options?.hasClient === false) {
    return { abort: true, reason: 'connection removed' }
  }
  return { abort: false }
}
