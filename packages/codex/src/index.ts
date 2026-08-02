/**
 * @superone/codex — electron-free Codex App Server turn client
 * (`packages/core/codex`).
 *
 * Desktop has a richer app-server pool; the node CLI uses this minimal client
 * for Stage 4+ production turns. Hosts must not re-implement the protocol.
 */

export {
  openCodexAppServer,
  runCodexAppServerTurn,
  safePublicError,
  type CodexAppServerClientOptions,
  type CodexAppServerHandle,
  type CodexSpawnFn,
} from './app-server-client'
export {
  forkCodexThread,
  type CodexRpcRequest,
  type ForkCodexThreadInput,
} from './fork-thread'
export {
  buildCodexReasoningItem,
  createCodexAgentEventMapper,
  deriveCodexFinalResponse,
  mapCodexThreadItem,
  mapCodexUsage,
  readCodexDeltaText,
  readCodexItemId,
  type CodexAgentEventMapper,
  type CodexAgentEventMapperOptions,
  type CodexAppServerNotification,
  type CodexNotificationApplyResult,
} from './agent-event-mapper'
