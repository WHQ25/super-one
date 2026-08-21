export { loadOrCreateLocalEnvironmentId } from './local-identity'
export {
  LocalEnvironmentGateway,
  type LocalEnvironmentGatewayOptions,
} from './local-environment-gateway'
export { EnvironmentRegistryImpl } from './environment-registry'
export { NodeCredentialStore, type NodeDeviceCredential, type CredentialSaveResult } from './node-credential-store'
export { ConnectionSupervisor, type SupervisorState, type SupervisorSnapshot } from './connection-supervisor'
export { NodeRpcClient } from './node-rpc-client'
export { RemoteEnvironmentGateway } from './remote-environment-gateway'
export { NodeConnectionManager, type KnownEnvironmentRecord } from './node-connection-manager'
export {
  generateDeviceKeyPair,
  pairWithNode,
  refreshNodeAccess,
  mintWsTicket,
} from './node-auth-client'
export { startSshLocalForward, sshCapture, findFreePort } from './ssh-forward'
export { WorkspaceRouter } from './workspace-router'
export { assertNodeIdentity } from './node-connection-manager'
export {
  EnvironmentHost,
  getEnvironmentHost,
  resetEnvironmentHostForTests,
  gatewayForProject,
} from './environment-host'
export {
  attachEnvironmentConnectivityMonitor,
  createOnlineEdgeWatcher,
} from './environment-connectivity-monitor'
export {
  listRemoteManagedSkills,
  listRemoteManagedMcp,
  saveRemoteManagedMcp,
  toggleRemoteManagedMcp,
  deleteRemoteManagedMcp,
  getRemoteManagedSkill,
  readRemoteManagedSkillFile,
  deleteRemoteManagedSkill,
  listRemoteManagedPlugins,
  listRemoteManagedHooks,
  saveRemoteManagedHook,
  deleteRemoteManagedHook,
  resolveRemoteResourceContext,
  remoteCodexGetAuthStatus,
  remoteCodexSetAuth,
  remoteCodexGetAccountStatus,
  remoteCodexAccountLoginStart,
  remoteCodexAccountLoginCancel,
  remoteCodexAccountLogout,
  remoteCodexGetRateLimits,
  remoteCodexGetAccountUsage,
  remoteCodexGetServerDiagnostics,
  remoteCodexGetConfigRequirements,
  remoteCodexConsumeRateLimitReset,
  remoteCodexLoginMcpOauth,
  remoteCodexDetectExternalAgent,
  remoteCodexImportExternalAgent,
  remoteCodexPluginsList,
  remoteCodexPluginsInstall,
  remoteCodexPluginsUninstall,
  remoteCodexMarketplaceAdd,
  remoteCodexMarketplaceRemove,
  remoteCodexMarketplaceUpgrade,
} from './remote-resources'
export {
  ensureEnvironmentResourceIpcRegistered,
  isEnvironmentResourceIpcRegistered,
  resetEnvironmentResourceIpcForTests,
} from './environment-resource-ipc'
export { listRemoteAgents, readRemoteAgentFile } from './remote-mentions'
export { probeEndpointHealth, discoverTailscaleHost } from './endpoint-probes'

// Register Skills/MCP IPC when the environment product surface loads.
// Renderer can invoke via window.electron.ipcRenderer when preload wrappers lag.
import { ensureEnvironmentResourceIpcRegistered } from './environment-resource-ipc'
ensureEnvironmentResourceIpcRegistered()
