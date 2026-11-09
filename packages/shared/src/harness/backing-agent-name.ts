import type { HarnessId } from '../agent-types'
import { acpAgentDisplayName } from './acp-brand'
import { HARNESS_CAPABILITIES } from './harness-capabilities'

/**
 * Name of the session's coding agent. ACP is a protocol, so the label is the
 * agent (Grok, Antigravity, …), not the harness display name "Others".
 */
export function backingAgentName(input: {
  provider: HarnessId
  acpAgentId?: string | null
  acpAgentCatalogName?: string | null
}): string {
  if (input.provider === 'acp') {
    return acpAgentDisplayName(input.acpAgentId, input.acpAgentCatalogName)
  }
  return HARNESS_CAPABILITIES[input.provider].displayName
}
