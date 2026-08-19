export { DeepseekEventMapper, displayToolName, type DeepseekMapperOptions } from './event-map'
export {
  SuperoneCredentialProvider,
  createCredentialPlugin,
  type CredentialLookup,
} from './credentials'
export {
  createDeepseekTree,
  deepseekAdapterPlugin,
  type DeepseekAdapterOptions,
  type DeepseekTreeOptions,
} from './tree'
export {
  DeepseekRuntime,
  type ApprovalDecision,
  type CreateDeepseekAgentOptions,
  type DeepseekCatalogEntry,
  type DeepseekAgentHandle,
  type DeepseekApprovalRequest,
  type DeepseekRuntimeOptions,
} from './runtime'
export {
  mountToolPlane,
  installPermissionGate,
  type DeepseekToolPermissionRequest,
  type DeepseekToolPlaneOptions,
  type ToolApprovalDecision,
} from './tool-plane'
export {
  mountSuperoneTools,
  superoneToolName,
  type SuperoneToolDescriptor,
  type SuperoneToolResult,
  type SuperoneToolSurface,
} from './tool-surface'
export { DeepseekMcpServers, type DeepseekMcpServerSpec } from './mcp-servers'
export { dshEffortFromSuperone, superoneEffortsFromDsh } from './reasoning-effort'
export {
  DEFAULT_DSH_PERMISSION_PRESET,
  DSH_PERMISSION_PRESETS,
  dshPresetForMode,
  type DshPermissionPreset,
} from './permission-presets'
export {
  DSH_FAMILY_PREFIX,
  installDshPeerResolver,
  registerDshPluginRoot,
} from './plugin-host/resolver'
export {
  DSH_PLUGIN_REGISTRY_VERSION,
  enabledPlugins,
  readPluginRegistry,
  updatePluginRegistry,
  resolvePluginEntryUrl,
  type DshPluginRegistry,
  type DshPluginRow,
} from './plugin-host/registry'
export {
  DEFAULT_NPM_REGISTRY,
  checkPeerLockstep,
  installPluginFromDirectory,
  installPluginFromNpm,
  installPluginFromTarball,
  lockstepBlocks,
  readPluginManifest,
  setPluginDisabled,
  uninstallPlugin,
  type InstallOptions,
  type InstallResult,
  type LockstepReport,
  type NpmInstallOptions,
  type PluginManifest,
  type TrustGrant,
} from './plugin-host/install'
export {
  DeepseekPlugins,
  type MountReport,
  type MountStatus,
  type PluginMountOutcome,
} from './plugin-host/mount'
