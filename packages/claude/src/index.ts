/**
 * @superone/claude — electron-free Claude Agent SDK turn core
 * (`packages/claude`).
 *
 * Desktop and CLI share this package so remote node Claude turns use the same
 * Agent SDK path as local SuperOne (no permanent print-mode side track).
 */

export { runClaudeSdkTurn } from './run-sdk-turn'
export { MessageBridge } from './message-bridge'
export {
  ClaudeLiveSession,
  openClaudeLiveSessionForTests,
  type ClaudeLiveSessionOptions,
  type ClaudeLiveTurnInput,
} from './claude-live-session'
export {
  buildClaudeResultMetadata,
  createClaudeAgentEventMapper,
  extractClaudeToolResultText,
  isClaudeToolLayerError,
  isResumeDropsTurnRefusal,
  RESUME_DROPS_TURN_REFUSAL_PREFIX,
  type ClaudeAgentEventApplyResult,
  type ClaudeAgentEventMapper,
  type ClaudeAgentEventMapperOptions,
} from './agent-event-mapper'
export {
  buildClaudeResultFailure,
  isClaudeResultError,
  type ClaudeResultFailure,
  type ClaudeResultFailureContext,
} from './result-failure'
export {
  resolveSdkClaudeBinary,
  resetSdkClaudeBinaryCacheForTests,
} from './resolve-sdk-binary'
export {
  fetchClaudeModels,
  mapClaudeModelInfo,
  type ClaudeModelInfo,
  type FetchClaudeModelsOptions,
} from './fetch-models'
export {
  ROOT_SAFE_PERMISSION_MODE,
  applyRootPermissionGuard,
  isRootWithoutSandboxOptIn,
  type RootPermissionGuardEnvironment,
  type RootPermissionGuardInput,
  type RootPermissionGuardResult,
} from './root-permission-guard'
export {
  applySdkMessage,
  createSdkMapState,
  type OpenTool,
  type SdkMapState,
  type SdkMapApplyResult,
} from './map-sdk-message'
export {
  forkClaudeTranscript,
  claudeProjectSlug,
  claudeProjectsDir,
  type ForkClaudeTranscriptInput,
  type SdkForkSessionFn,
} from './fork-session'
export {
  claudeTranscriptPath,
  inspectClaudeTranscript,
  type ClaudeTranscriptState,
} from './transcript-store'
export type {
  ClaudePermissionDecision,
  ClaudePermissionHandler,
  ClaudePermissionRequest,
  ClaudeQuestionHandler,
  ClaudeQuestionRequest,
  ClaudePlanHandler,
  ClaudePlanRequest,
  ClaudeQueryFn,
  ClaudeSdkTurnResult,
  RunClaudeSdkTurnOptions,
} from './types'
