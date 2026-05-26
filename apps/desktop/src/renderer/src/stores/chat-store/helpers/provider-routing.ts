import type { HarnessId } from '@superone/shared/agent-types'

export type ProviderResolvableSession = {
  sessionProvider: HarnessId | null
  preferredProvider: HarnessId
}

export function resolveProvider(session: ProviderResolvableSession): HarnessId {
  return session.sessionProvider ?? session.preferredProvider
}

export function inferProviderFromHarnessId(harnessId: string | null | undefined): HarnessId | null {
  if (harnessId === 'codex') return 'codex'
  if (harnessId === 'claude') return 'claude'
  return null
}
