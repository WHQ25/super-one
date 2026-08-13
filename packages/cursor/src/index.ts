/**
 * @superone/cursor — electron-free Cursor Agent SDK harness core
 * (`packages/cursor`).
 *
 * Desktop and CLI share this package so remote node Cursor turns use the same
 * SDK path as local SuperOne.
 */

export {
  readCursorConfig,
  readCursorModelParamsByModel,
  readStringIdList,
  readCursorDisabledModelIds,
  filterEnabledCursorModels,
  resolveCursorApiKeyPlain,
  mapPermissionToCursorLocal,
  buildCloudOptions,
  resolveCursorToolRestrictions,
  CURSOR_READONLY_TOOLS,
  type CursorConfig,
  type CursorCloudRepoConfig,
  type CursorModelParamsByModel,
} from './cursor-config'

export { isCursorSdkAvailable } from './cursor-sdk-available'

export {
  toCursorMcpConfig,
  mcpServersToStatus,
  stripStdioCwd,
} from './cursor-mcp-map'

export {
  buildCursorCustomTools,
} from './cursor-custom-tools'

export {
  mapInteractionUpdate,
  mapConversationStep,
  mapSdkMessageLifecycle,
  extractToolCallParts,
  toolDisplayName,
  stableIdField,
  CursorTurnCallIdBridge,
} from './cursor-event-map'

export {
  BetterSqliteLocalAgentStore,
  getCursorAgentStore,
} from './cursor-store'

export {
  probeCursorResources,
  validateCursorApiKey,
  Agent,
  Cursor,
} from './cursor-client'

export {
  mapCursorModel,
  buildCursorModelSelection,
  defaultCursorModelParams,
  findCursorEffortParam,
  isCursorFastParam,
  isCursorEffortParam,
  isCursorToggleParam,
  cursorParamLabel,
  cursorParamValueLabel,
  normalizeEffortValue,
  parseCursorContextWindow,
  firstParseableCursorContextValue,
  resolveCursorSelectedContextWindow,
  type BuildCursorModelSelectionInput,
} from './cursor-model-selection'

export {
  listCursorCloudAgents,
  listCursorLocalAgents,
  getCursorAgent,
  listCursorAgentMessages,
  getCursorRun,
  cancelCursorRun,
  listCursorRuns,
  archiveCursorAgent,
  unarchiveCursorAgent,
  deleteCursorAgent,
  listCursorRepositories,
  withResumedAgentArtifacts,
  listCursorArtifacts,
  downloadCursorArtifact,
  getCursorAgentUsage,
  type CursorCloudListAgentsOptions,
} from './cursor-cloud'

export {
  cursorSdkLogin,
  cursorSdkAuthStatus,
  cursorSdkLogout,
  type CursorSdkLoginResult,
  type CursorSdkAuthStatus,
} from './cursor-sdk-auth'

export {
  createCursorRuntime,
  setCursorRuntimeFactory,
  getCursorRuntimeFactory,
  CursorIntegrationError,
  type CursorRuntime,
  type CursorRuntimeOptions,
  type CursorRuntimeFactory,
  type CursorSendOptions,
  type CursorSendResult,
  type CursorRuntimeLog,
} from './cursor-runtime'

export {
  discoverCursorSkillsAndCommands,
  stripMarkdownFrontmatter,
} from './cursor-skills-discover'

export {
  runCursorSdkTurn,
  type RunCursorSdkTurnOptions,
  type CursorSdkTurnResult,
} from './run-sdk-turn'

export {
  createSimulatedCursorTurnRunner,
  createCursorTurnRunner,
  type CreateCursorTurnRunnerOptions,
} from './simulated-runner'
