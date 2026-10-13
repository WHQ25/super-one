import { openCodeProviderConfig } from '@superone/opencode/provider-config'
import type { ProviderStore } from './provider-store'
import { resolveHarnessService } from './resolve-service'

/** Explicit selections and existing bindings never fall back to another account. */
export function resolveNodeOpenCodeProvider(store: ProviderStore | undefined, apiProviderId?: string | null,
  env: Record<string, string> = {}) {
  const selected = apiProviderId?.trim() || store?.listBindings().find(binding => binding.consumer === 'chat:opencode')?.credentialId
  if (!selected) return null
  if (!store) throw new Error('OpenCode provider store is unavailable')
  const service = resolveHarnessService(store, 'opencode', selected)
  if (!service) throw new Error('Selected OpenCode provider is unavailable; configure its credential and chat endpoint')
  return openCodeProviderConfig(service, env.OPENCODE_CONFIG_CONTENT)
}
