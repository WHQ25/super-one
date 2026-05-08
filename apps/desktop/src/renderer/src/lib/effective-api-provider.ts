import type { ApiProvider, HarnessId } from '@superone/shared/agent-types'
import { providerSupportsHarness } from '@superone/shared/provider-utils'

export function selectEffectiveApiProvider(
  providers: ApiProvider[],
  harness: HarnessId,
  sessionApiProviderId: string | null,
): ApiProvider | null {
  if (sessionApiProviderId) {
    const explicit = providers.find((p) => p.id === sessionApiProviderId)
    if (explicit && providerSupportsHarness(explicit, harness)) return explicit
  }
  const activeCol = harness === 'codex' ? 'is_active_codex' : 'is_active_claude'
  return providers.find((p) => p[activeCol] === 1) ?? null
}
