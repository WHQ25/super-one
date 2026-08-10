/**
 * CLI view of harness readiness probing. The state machine lives in
 * `@superone/runtime/harness`; this module binds it to the CLI's binary
 * resolver and ProviderStore-backed auth probe.
 */
import {
  assertSessionHarnessRuntimeReady as kernelAssertRuntimeReady,
  probeHarnessReadiness as kernelProbeReadiness,
  type HarnessManager,
  type ProbeHarnessResult,
  type RuntimeReadyResult,
} from '@superone/runtime/harness'
import type { NodeHarnessId } from '@superone/shared/environment'
import { cliHarnessAuthProbe, cliHarnessResolver } from './harness-host'
import type { ProviderStore } from '../provider/provider-store'

export type { ProbeHarnessResult, RuntimeReadyResult }

export function assertSessionHarnessRuntimeReady(
  sessionHarnessId: string,
  harnesses: HarnessManager,
): RuntimeReadyResult {
  return kernelAssertRuntimeReady(sessionHarnessId, harnesses, cliHarnessResolver)
}

export function probeHarnessReadiness(
  harnesses: HarnessManager,
  id: NodeHarnessId,
  providers?: ProviderStore | null,
): ProbeHarnessResult {
  return kernelProbeReadiness(harnesses, id, {
    resolver: cliHarnessResolver,
    auth: cliHarnessAuthProbe(providers),
  })
}
