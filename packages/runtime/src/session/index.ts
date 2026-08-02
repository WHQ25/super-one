/**
 * @superone/runtime/session — electron-free session turn runtime.
 *
 * Hosts supply SessionStore + SessionEventLog + LeaseGuard (SQLite on the node).
 */

export {
  SessionRuntime,
  createSimulatedTurnRunner,
  createSimulatedCodexRunner,
  deriveSessionTitleFromUserText,
  forkSessionTitle,
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
export {
  createSqliteHostActionStore,
  ensureHostActionTables,
  DEFAULT_HOST_ACTION_DEADLINE_MS,
  DEFAULT_HOST_ACTION_CLAIM_TTL_MS,
  type HostActionStore,
  type HostActionRow,
  type CreateHostActionInput,
} from './host-action-store'
