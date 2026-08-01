/**
 * @superone/runtime/session — electron-free session turn runtime.
 *
 * Hosts supply SessionStore + SessionEventLog + LeaseGuard (SQLite on the node).
 */

export {
  SessionRuntime,
  createSimulatedTurnRunner,
  createSimulatedCodexRunner,
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
} from './session-runtime'
export { EventLog } from './event-log'
export { createSqliteSessionStore } from './sqlite-session-store'
