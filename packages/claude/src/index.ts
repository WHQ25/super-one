/**
 * @superone/claude — electron-free Claude Agent SDK turn core
 * (`packages/claude`).
 *
 * Desktop and CLI share this package so remote node Claude turns use the same
 * Agent SDK path as local SuperOne (no permanent print-mode side track).
 */

export { runClaudeSdkTurn } from './run-sdk-turn'
export {
  resolveSdkClaudeBinary,
  resetSdkClaudeBinaryCacheForTests,
} from './resolve-sdk-binary'
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
export type {
  ClaudePermissionDecision,
  ClaudePermissionHandler,
  ClaudePermissionRequest,
  ClaudeQueryFn,
  ClaudeSdkTurnResult,
  RunClaudeSdkTurnOptions,
} from './types'
