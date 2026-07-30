export { ComputerUseService, resetComputerUseIds, evaluateCondition } from './computer-use-service'
export { createComputerUseService } from './create-service'
export {
  resolveComputerUseGrant,
  rejectComputerUseGrant,
  ensureComputerUseAppGrant,
  clearPendingComputerUseGrants,
} from './grant-request'
export {
  COMPUTER_USE_HARNESS_IDS,
  computerUseQualifiedNames,
  isComputerUseQualifiedName,
  harnessRecoveryForComputerUseToggle,
} from './harness-surface'
export { ComputerUsePolicy } from './policy'
export { StateStore } from './state-store'
export { ResourceScheduler } from './resource-scheduler'
export { RootRegistry } from './root-registry'
export { FakePlatformBackend, defaultWorld } from './platform/fake-backend'
export { MacosPlatformAdapter } from './platform/macos-adapter'
export {
  resolveHelperAppPath,
  defaultHelperSocketPath,
  getSharedHelperClient,
  resetSharedHelperClient,
  DEV_HELPER_APP_NAME,
  DEV_HELPER_BUNDLE_ID,
  RELEASE_HELPER_APP_NAME,
  RELEASE_HELPER_BUNDLE_ID,
} from './platform/macos-helper-client'
export {
  startComputerUseHelper,
  stopComputerUseHelper,
  getComputerUsePermissionStatus,
} from './computer-use-helper-lifecycle'
export type { ComputerUsePermissionStatus } from './computer-use-helper-lifecycle'
export {
  showComputerUsePermissionFloat,
  closeComputerUsePermissionFloat,
  destroyComputerUsePermissionFloat,
  continueComputerUsePermissionStep,
  resizeComputerUsePermissionFloat,
  openComputerUsePrivacyPane,
} from './computer-use-permission-window'
export type { PrivacyPane, PermissionFloatFlow } from './computer-use-permission-window'
export type { PlatformAdapter } from './platform/types'
export {
  COMPUTER_USE_TOOL_NAMES,
  isComputerUseToolName,
  isComputerUseEnabled,
  setComputerUseEnabledForTests,
  getComputerUseToolDescriptors,
  registerComputerUseTools,
  executeComputerUseTool,
  getOrCreateComputerUseService,
  disposeComputerUseService,
  clearComputerUseServices,
  syncAllComputerUseServicesFromSettings,
  hideComputerUseVisuals,
  grantComputerUseSessionApps,
  normalizeComputerUseToolName,
} from './tools'
export {
  persistComputerUseScreenshot,
  writeOptimizedAgentImage,
  needsComputerUseOptimize,
  COMPUTER_USE_SCREENSHOT_DIR,
  CU_AGENT_MAX_SIDE,
  CU_AGENT_MAX_BYTES,
} from './screenshot-store'
export type { ComputerUseToolName, ComputerUseToolReply } from './tools'
export {
  ComputerUseError,
  type ActionOutcome,
  type ActResult,
  type AppCatalogEntry,
  type AppsActionResult,
  type AppsListResult,
  type AppsListOptions,
  type AppsSnapshot,
  type CaptureScope,
  type Condition,
  type ComputerUseState,
  type ObserveResult,
  type UiAction,
  type UiOutlineNode,
  type UiRootIdentity,
} from './types'
