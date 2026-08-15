import type { ProviderStore } from '../provider/provider-store'
import type { RpcHostHooks } from '@superone/runtime/server'
import { isClaudeBinaryOverrideRunnable } from '../session/claude-turn-runner'
import { isCodexBinaryOverrideRunnable } from '../session/codex-turn-runner'
import { resolveCliReleaseVersion } from '../cli-release-version'
import { disableHarness, enableHarness } from '../session/harness-enable'
import { assertSessionHarnessRuntimeReady, probeHarnessReadiness } from '../session/harness-runtime-ready'
import { listHarnessModels } from '../provider/resolve-service'

/** CLI implementations of the host-specific RPC hooks. */
export function createCliRpcHostHooks(): RpcHostHooks {
  return {
    isCodexBinaryOverrideRunnable,
    isClaudeBinaryOverrideRunnable,
    resolveReleaseVersion: resolveCliReleaseVersion,
    listHarnessModels: (store, harness, apiProviderId, options) =>
      listHarnessModels(store as ProviderStore, harness, apiProviderId, options),
    probeHarnessReadiness: (harnesses, id, providers) =>
      probeHarnessReadiness(harnesses, id, (providers as ProviderStore | null | undefined) ?? null),
    assertSessionHarnessRuntimeReady,
    enableHarness: (harnesses, input, providers) =>
      enableHarness(harnesses, input, (providers as ProviderStore | null | undefined) ?? null),
    disableHarness,
  }
}
