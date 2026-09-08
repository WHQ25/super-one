/**
 * @superone/acp — ACP harness turn core for node.
 */

export {
  createSimulatedAcpTurnRunner,
  createAcpTurnRunner,
  type CreateAcpTurnRunnerOptions,
} from './simulated-runner'
export {
  createAcpAgentTurnRunner,
  type RunAcpTurnOptions,
} from './run-turn'
export {
  spawnAcpProcess,
  buildAcpProcessEnv,
  type AcpLaunch,
  type AcpProcessHandle,
} from './process'
export {
  mapPermissionRequest,
  mapPermissionDecision,
  ALLOW_ALWAYS_MCP_OPTION_ID,
  type PendingPermissionOptions,
} from './permission-map'
export {
  cancelOpenAcpTools,
  createAcpAgentEventMapper,
  getAcpAgentChunkMessageId,
  mapSessionUpdate,
  mapStopReason,
  trackOpenAcpTools,
  type AcpAgentEventApplyResult,
  type AcpAgentEventMapper,
  type AcpAgentEventMapperOptions,
  type AcpMapContext,
  type MapSessionUpdateOptions,
} from './agent-event-mapper'
export {
  extractEmbeddedTerminalId,
  normalizeAcpTool,
  type NormalizedAcpTool,
} from './tool-normalization'
export { formatAcpRawOutput } from './tool-result-map'
export {
  mapXaiSessionUpdate,
  mapXaiStandaloneNotification,
  noteContextTokensFromMeta,
  noteContextWindow,
  uncachedPromptInputTokens,
  type MapXaiNotifyContext,
} from './xai-event-map'
export {
  formatGrokElicitOutcome,
  formatGrokScheduledTaskPrompt,
  grokElicitToPendingInteraction,
  parseGrokElicitComplete,
  parseGrokScheduledInject,
} from './xai-elicit'
export {
  XAI_EXT_NOTIFICATION_METHODS,
  XAI_FOLLOW_UPS,
  XAI_MONITOR_EVENT,
  XAI_MCP_ELICIT,
  XAI_MCP_ELICIT_COMPLETE,
  XAI_SCHEDULED_TASK_CREATED,
  XAI_SCHEDULED_TASK_DELETED,
  XAI_SCHEDULED_TASK_FIRED,
  XAI_SCHEDULED_TASK_INJECT_PROMPT,
  XAI_SESSION_INTERJECTION,
  XAI_SESSION_NOTIFICATION,
  XAI_SESSION_UPDATE,
  XAI_TASK_BACKGROUNDED,
  XAI_TASK_COMPLETED,
  createXaiCorrelationState,
  noteToolCorrelationFromAgentEvents,
  parsePlainTextTaskAck,
  parseXaiExtParams,
  parseXaiSessionNotificationEnvelope,
  type BgTaskInfo,
  type XaiCorrelationState,
  type XaiSessionNotificationEnvelope,
} from './xai-state'
