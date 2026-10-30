import { homedir } from 'node:os'
import type { ProviderStore } from '../provider/provider-store'
import type { HarnessManager } from '../session/harness-manager'
import type { RpcHostHooks } from '@superone/runtime/server'
import { isClaudeBinaryOverrideRunnable, resolveClaudeBinaryPath } from '../session/claude-turn-runner'
import { isCodexBinaryOverrideRunnable } from '../session/codex-turn-runner'
import { resolveCliReleaseVersion } from '../cli-release-version'
import { disableHarness, enableHarness } from '../session/harness-enable'
import { assertSessionHarnessRuntimeReady, probeHarnessReadiness } from '../session/harness-runtime-ready'
import { isClaudeAccountProvider } from '@superone/shared/agent-types'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { listHarnessModels, listHarnessProviderModels } from '../provider/resolve-service'
import { resolveNodeOpenCodeProvider } from '../provider/opencode-provider'
import { getNodeClaudeModelCatalog } from '../session/claude-model-catalog'
import { claudeAccountProbeEnv, claudeCatalogCacheScope } from '../session/claude-probe-env'
import { getNodeCodexModelCatalog } from '../session/codex-model-catalog'

/** CLI implementations of the host-specific RPC hooks. */
export function createCliRpcHostHooks(): RpcHostHooks {
  return {
    isCodexBinaryOverrideRunnable,
    isClaudeBinaryOverrideRunnable,
    resolveReleaseVersion: resolveCliReleaseVersion,
    listHarnessModels: (store, harness, apiProviderId, options) => harness === 'opencode'
      ? resolveNodeOpenCodeProvider(store as ProviderStore, apiProviderId)?.models ?? []
      : listHarnessModels(store as ProviderStore, harness, apiProviderId, options),
    listLiveHarnessModels: async ({ store, harness, apiProviderId, harnesses, options }) => {
      const fromProvider = listHarnessProviderModels(
        store as ProviderStore,
        harness,
        apiProviderId,
        options,
      )
      if (fromProvider.length > 0) return fromProvider
      if (harness === 'claude') {
        // A custom credential with no models of its own keeps the stale slug
        // table. The subscription catalog belongs to a Claude account login.
        if (apiProviderId && !isClaudeAccountProvider(apiProviderId)) return []
        const binaryPath = resolveClaudeBinaryPath({ harnesses: harnesses as HarnessManager | undefined })
        if (!binaryPath) {
          console.warn(
            '[provider.listModels] claude probe skipped: no Agent SDK binary on this node',
          )
          return []
        }
        const probed = await getNodeClaudeModelCatalog({
          cwd: homedir(),
          binaryPath,
          env: claudeAccountProbeEnv(apiProviderId),
          accountScope: claudeCatalogCacheScope(apiProviderId),
        })
        if (probed.length === 0) {
          console.warn(
            '[provider.listModels] claude probe returned no models; serving the built-in fallback table',
          )
        }
        return probed
      }
      if (harness !== 'codex') return null
      // model/list is the ChatGPT account catalog. A custom credential with no
      // models of its own keeps the stale slug table instead of that catalog.
      if (apiProviderId && !isCodexAccountProvider(apiProviderId)) return []
      const probed = await getNodeCodexModelCatalog({
        apiProviderId,
        harnesses: harnesses as HarnessManager | undefined,
      })
      if (probed.length === 0) {
        console.warn(
          '[provider.listModels] codex probe returned no models; serving the built-in fallback table',
        )
      }
      return probed
    },
    probeHarnessReadiness: (harnesses, id, providers) =>
      probeHarnessReadiness(harnesses, id, (providers as ProviderStore | null | undefined) ?? null),
    assertSessionHarnessRuntimeReady,
    enableHarness: (harnesses, input, providers) =>
      enableHarness(harnesses, input, (providers as ProviderStore | null | undefined) ?? null),
    disableHarness,
    forkHarnessResume: async ({ source, targetCwd, forkFromMessageId, ...opts }) => {
      const { forkNodeHarnessResume } = await import('../session/harness-fork')
      return forkNodeHarnessResume(
        source,
        targetCwd,
        {
          ...opts,
          harnesses: opts.harnesses as HarnessManager | undefined,
          providers: opts.providers as ProviderStore | undefined,
        },
        forkFromMessageId,
      )
    },
  }
}
