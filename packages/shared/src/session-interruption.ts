/** Infrastructure restarts are distinct from an explicit user interruption. */
export function isNodeRestartInterruption(reason: unknown): boolean {
  return reason === 'node_restart' || reason === 'node_restart_non_reattachable'
}
