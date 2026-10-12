import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'

export type ProviderResolvableSession = {
  sessionProvider: HarnessId | null
  preferredProvider: HarnessId
}

export function resolveProvider(session: ProviderResolvableSession): HarnessId {
  return session.sessionProvider ?? session.preferredProvider
}

export function isExperimentalAgentProvider(provider: HarnessId, acpAgentId?: string | null): boolean {
  if (provider === 'acp') return acpAgentId ? !isGrokAcpAgent(acpAgentId) : false
  return provider === 'opencode'
}

/** A host's harness id as a renderer provider; null for an id this build does not know. */
export function inferProviderFromHarnessId(harnessId: string | null | undefined): HarnessId | null {
  return harnessId && Object.hasOwn(HARNESS_CAPABILITIES, harnessId) ? harnessId as HarnessId : null
}
