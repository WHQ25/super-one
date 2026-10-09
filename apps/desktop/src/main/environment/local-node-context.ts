import type { EnvironmentLiveStatus, EnvironmentMachine } from '@superone/shared/environment'
import { getMachineInfo, readLiveStatus } from '@superone/runtime/machine'

/** What `environment_get_info` reports for this desktop, computed in-process. */
export async function readLocalNodeContext(): Promise<{ machine: EnvironmentMachine; live: EnvironmentLiveStatus }> {
  return { machine: await getMachineInfo(), live: readLiveStatus() }
}
