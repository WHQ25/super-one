export { nodeIdentityPaths } from './node-paths'
export {
  loadOrCreateIdentity,
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
  type NodeRpcDispatch,
  type NodeAuthPort,
} from './node-server'
export type {
  RpcContext,
  RpcResult,
  RpcHostHooks,
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
