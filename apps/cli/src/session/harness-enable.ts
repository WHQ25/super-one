/**
 * CLI view of harness enable/disable. Orchestration lives in
 * `@superone/runtime/harness`; this module supplies the CLI's node home,
 * release version, binary resolver, npm installer, and auth probe.
 */
import {
  enableHarness as kernelEnableHarness,
  enableManaged as kernelEnableManaged,
  type EnableHarnessInput,
  type HarnessManager,
} from '@superone/runtime/harness'
import type { HarnessInstallationStatus } from '@superone/shared/environment'
import type { ManagedHarnessId } from '@superone/runtime/harness/managed-release'
import { cliHarnessDeps } from './harness-host'
import type { ProviderStore } from '../provider/provider-store'

export type { EnableHarnessInput }
export { disableHarness, enableOpencode, enableAcpGrok, enableCursor } from '@superone/runtime/harness'

export function enableHarness(
  manager: HarnessManager,
  input: EnableHarnessInput,
  providers?: ProviderStore | null,
): Promise<HarnessInstallationStatus> {
  return kernelEnableHarness(manager, input, cliHarnessDeps(providers))
}

export function enableManaged(
  manager: HarnessManager,
  id: ManagedHarnessId,
  artifact: string | undefined,
  mode: 'enable' | 'repair' = 'enable',
): Promise<HarnessInstallationStatus> {
  return kernelEnableManaged(manager, id, artifact, cliHarnessDeps(), mode)
}
