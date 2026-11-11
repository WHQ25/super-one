import type { HarnessId } from '@superone/shared/agent-types'
import { resolveLegacyHarnessId } from '@superone/shared/acp-brand'

export type ProviderResolvableSession = {
  sessionProvider: HarnessId | null
  preferredProvider: HarnessId
}

export function resolveProvider(session: ProviderResolvableSession): HarnessId {
  return session.sessionProvider ?? session.preferredProvider
}

export function isExperimentalAgentProvider(provider: HarnessId, _acpAgentId?: string | null): boolean {
  return provider === 'opencode'
}

/** A host's harness id as a renderer provider; null for an id this build does not know. */
export function inferProviderFromHarnessId(
  harnessId: string | null | undefined,
  acpAgentId?: string | null,
): HarnessId | null {
  return resolveLegacyHarnessId(harnessId, { acpAgentId })
}
