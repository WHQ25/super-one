import type { PerSessionState } from '@/stores/chat-store/types'

/** A native catalog belongs to the OpenCode runtime that reported it. */
export function openCodeSessionModels(session: Pick<PerSessionState, 'runtimeCapabilities' | 'sessionModels'>) {
  return session.runtimeCapabilities?.harnessId === 'opencode' ? session.sessionModels : undefined
}

/** Only host-owned OpenCode sessions can refresh their native resources. */
export function ownsOpenCodeSession(session: Pick<PerSessionState, 'hostSessionOwned' | 'sessionProvider' | 'preferredProvider'>): boolean {
  return session.hostSessionOwned === true && (session.sessionProvider ?? session.preferredProvider) === 'opencode'
}
