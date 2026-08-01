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
  type AcpLaunch,
  type AcpProcessHandle,
} from './process'
export {
  mapPermissionRequest,
  mapPermissionDecision,
  ALLOW_ALWAYS_MCP_OPTION_ID,
  type PendingPermissionOptions,
} from './permission-map'
