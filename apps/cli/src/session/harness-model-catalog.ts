import { probeAcpModels } from '@superone/acp/model-catalog'
import { resolveProductionAcpLaunch } from './acp-launch'
import { resolveCliReleaseVersion } from '../cli-release-version'
import { homedir } from 'node:os'
import type { ProviderStore } from '../provider/provider-store'
import type { HarnessManager } from './harness-manager'
import type { RpcHostHooks } from '@superone/runtime/server'
import { isClaudeAccountProvider } from '@superone/shared/agent-types'
import { isCodexAccountProvider } from '@superone/shared/codex-accounts'
import { getNodeClaudeModelCatalog } from './claude-model-catalog'
import { claudeAccountProbeEnv, claudeCatalogCacheScope } from './claude-probe-env'
import { getNodeCodexModelCatalog } from './codex-model-catalog'
import { resolveClaudeBinaryPath } from './claude-turn-runner'
import { listHarnessProviderModels } from '../provider/resolve-service'

/** Account-aware live catalog shared by provider RPC and suggested-task launches. */
export async function listNodeLiveHarnessModels({ store, harness, apiProviderId, harnesses, options, force }: Parameters<NonNullable<RpcHostHooks['listLiveHarnessModels']>>[0]) {
  const fromProvider = listHarnessProviderModels(
    store as ProviderStore,
    harness,
    apiProviderId,
    options,
  )
  if (fromProvider.length > 0) return fromProvider
  if (harness === 'acp-grok' || harness === 'acp-antigravity' || harness === 'acp') {
    const launch = resolveProductionAcpLaunch({ harnesses: harnesses as HarnessManager | undefined })
    if (!launch.binaryPath) return []
    return probeAcpModels({ launch: { command: launch.binaryPath, args: launch.args, agentId: launch.agentId },
      cwd: homedir(), clientVersion: resolveCliReleaseVersion() })
  }
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
      force,
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
    force,
  })
  if (probed.length === 0) {
    console.warn(
      '[provider.listModels] codex probe returned no models; serving the built-in fallback table',
    )
  }
  return probed
}
