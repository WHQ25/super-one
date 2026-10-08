export { nodeIdentityPaths } from './node-paths'
export {
  loadOrCreateIdentity,
  loadOrCreateChannelRoot,
  regenerateIdentity,
  computeBindingHash,
  type NodeIdentity,
  type IdentityFiles,
} from './identity'
export {
  AuthService,
  type AuthenticatedClient,
  type PairingTokenRecord,
  type PairExchangeResult,
  type AccessTokenResult,
  type WsTicketResult,
} from './auth-service'
export {
  startNodeServer,
  type NodeServerOptions,
  type NodeServerHandle,
  type NodeSecureChannelOptions,
  type NodeRpcDispatch,
  type NodeRpcRequestContext,
  type NodeAuthPort,
} from './node-server'
export {
  deriveIssuedChannelSecret,
  issueChannelCredential,
  type ChannelCredential,
} from '@superone/relay-client/secure-channel'
export { dispatchRpc, clearWatchBuffersForClient } from './rpc-dispatch'
export type {
  RpcContext,
  RpcResult,
  RpcHostHooks,
  RpcExtensionDispatch,
  HostCapabilityFlags,
  SessionHostPort,
  ControlLeasePort,
  ArtifactZonePort,
  ProjectsPort,
  TerminalsPort,
  WorkspaceFsPort,
  WorkspaceGitPort,
  WorkspaceWatchPort,
  WorkspaceTailWatchPort,
  CollaborationPort,
  IdempotencyPort,
  ProvidersPort,
} from './rpc-context'
