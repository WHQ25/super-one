/**
 * @superone/cursor — electron-free Cursor Agent SDK harness core
 * (`packages/cursor`).
 *
 * Desktop and CLI share this package so remote node Cursor turns use the same
 * SDK path as local SuperOne.
 */

export {
  readCursorConfig,
  resolveCursorApiKeyPlain,
  mapPermissionToCursorLocal,
  buildCloudOptions,
  isCursorSdkAvailable,
  type CursorConfig,
  type CursorCloudRepoConfig,
} from './cursor-config'

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
  mapSdkMessageLifecycle,
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
  type CursorCloudListAgentsOptions,
} from './cursor-cloud'

export {
  createCursorRuntime,
  setCursorRuntimeFactory,
  getCursorRuntimeFactory,
  type CursorRuntime,
  type CursorRuntimeOptions,
  type CursorRuntimeFactory,
  type CursorSendOptions,
  type CursorRuntimeLog,
} from './cursor-runtime'

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
