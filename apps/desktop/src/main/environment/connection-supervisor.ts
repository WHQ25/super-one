/**
 * Desktop re-export of the platform-neutral ConnectionSupervisorCore.
 * Electron Main must not fork a second state machine — mobile adapters share the same core.
 */
export {
  ConnectionSupervisorCore as ConnectionSupervisor,
  type SupervisorState,
  type BlockReason,
  type SupervisorSnapshot,
  type SupervisorCoreOptions as SupervisorOptions,
  type SupervisorWakeReason,
  type RetryNowDisposition,
} from '@superone/shared/environment'
