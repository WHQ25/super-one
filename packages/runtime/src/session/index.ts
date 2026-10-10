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
  DEFAULT_AGENTS_CONFIRM_TIMEOUT_MS,
  type NodeSessionRecord,
  type NodeSessionSettings,
  type PendingInteraction,
  type AgentsConfirmOutcome,
  type ElicitationDecision,
  type PermissionDecision,
  type PlanDecisionResult,
  type QuestionAnswers,
  type SessionStatus,
  type SessionTurnEvent,
  type TranscriptBlock,
  type TurnRunner,
  type ActiveHarnessRuntime,
  type LeaseGuard,
  type SessionEventLog,
  type SessionStore,
} from './session-runtime'
export {
  getRuntimeIdleTimeoutMs,
  SESSION_RUNTIME_REAPER_INTERVAL_MS,
} from './runtime-policy'
export type { TurnImageAttachment } from './types'
export { EventLog } from './event-log'
export { SessionReadModel, sessionReadModel } from './read-model'
export { StreamingRing, STREAMING_RING_MAX_BYTES } from './streaming-ring'
export {
  buildSessionMessageCatalog,
  collectContentByAssistantId,
  collectToolsByAssistantId,
  pageSessionMessageCatalog,
} from './message-catalog'
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
export {
  HostActionChannel,
  type HostActionChannelDeps,
  type HostActionSessionView,
} from './host-action-channel'
export {
  createSessionProviderStore,
  ensureSessionProvidersTable,
  settingsFromSessionProviderConfig,
  type SessionProviderRecord,
  type SessionProviderStore,
  type CreateSessionProviderInput,
  type UpdateSessionProviderInput,
} from './session-provider-store'
export {
  collectHarnessResources,
  discoverCodexUserPrompts,
  type CollectHarnessResourcesInput,
  type HarnessResourcesBundle,
  type HarnessResourcesClaude,
  type HarnessResourcesCodex,
  type HarnessResourcesOpenCode,
} from './harness-resources'
