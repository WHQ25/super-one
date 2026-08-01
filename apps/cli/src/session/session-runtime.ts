/**
 * CLI SessionRuntime: wires SQLite store + EventLog + ControlLeaseService into
 * `@superone/runtime/session`. Prefer importing types from the core package.
 */

import {
  SessionRuntime as CoreSessionRuntime,
  type LeaseGuard,
  type SessionEventLog,
  type TurnRunner,
} from '@superone/runtime/session'
import type { NodeDatabase } from '../db/database'
import type { ControlLeaseService } from '@superone/runtime/lease'
import type { EventLog } from '@superone/runtime/session'
import { createSqliteSessionStore } from '@superone/runtime/session'

export {
  createSimulatedCodexRunner,
  createSimulatedTurnRunner,
  DEFAULT_PERMISSION_TIMEOUT_MS,
  type NodeSessionRecord,
  type PendingInteraction,
  type PermissionDecision,
  type SessionStatus,
  type SessionTurnEvent,
  type TranscriptBlock,
  type TurnRunner,
  type LeaseGuard,
  type SessionEventLog,
  type SessionStore,
} from '@superone/runtime/session'

/**
 * Drop-in constructor matching the historical `(db, events, leases, …)` signature.
 */
export class SessionRuntime extends CoreSessionRuntime {
  constructor(
    db: NodeDatabase,
    events: EventLog & SessionEventLog,
    leases: ControlLeaseService & LeaseGuard,
    environmentId: string,
    turnRunner: TurnRunner,
    opts?: { permissionTimeoutMs?: number },
  ) {
    super(createSqliteSessionStore(db), events, leases, environmentId, turnRunner, opts)
  }
}
