import type { HarnessId } from '../agent-types'
import { acpAgentDisplayName, acpAgentIdForHarness, isAcpProtocolHarness, resolveLegacyHarnessId } from './acp-brand'
import { HARNESS_CAPABILITIES } from './harness-capabilities'

export function backingAgentName(input: {
  provider: HarnessId | string
  acpAgentId?: string | null
  acpAgentCatalogName?: string | null
}): string {
  const provider = resolveLegacyHarnessId(input.provider, { acpAgentId: input.acpAgentId })
  if (provider && isAcpProtocolHarness(provider)) {
    return acpAgentDisplayName(input.acpAgentId ?? acpAgentIdForHarness(provider), input.acpAgentCatalogName)
  }
  if (provider) return HARNESS_CAPABILITIES[provider].displayName
  return acpAgentDisplayName(input.acpAgentId, input.acpAgentCatalogName)
}
