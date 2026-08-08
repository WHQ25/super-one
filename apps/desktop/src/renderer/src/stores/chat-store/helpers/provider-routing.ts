import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent } from '@superone/shared/acp-brand'

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

export function inferProviderFromHarnessId(harnessId: string | null | undefined): HarnessId | null {
  if (harnessId === 'codex') return 'codex'
  if (harnessId === 'claude') return 'claude'
  if (harnessId === 'acp') return 'acp'
  if (harnessId === 'opencode') return 'opencode'
  return null
}
