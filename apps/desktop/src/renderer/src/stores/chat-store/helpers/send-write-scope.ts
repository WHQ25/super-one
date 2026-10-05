import type { ChatStore, SessionWriteTarget } from '../types'
import type { ChatStoreSet } from './lifecycle'
import { commitPerSession, getProject, getScopedPerSession } from './store-helpers'

/** A send may adopt a durable session id; every subsequent write follows that owner. */
export function createSendWriteScope(set: ChatStoreSet, get: () => ChatStore, projectPath: string, target?: SessionWriteTarget) {
  const scope = {
    target: target ? { ...target } : undefined as SessionWriteTarget | undefined,
    sessionId: (): string | null => scope.target?.sessionId ?? getProject(get(), projectPath)._activeSessionId,
    patch: (updater: (session: ReturnType<typeof getScopedPerSession>) => Partial<ReturnType<typeof getScopedPerSession>>) => {
      set(state => commitPerSession(state, scope.target, updater))
    },
  }
  return scope
}

export type SendWriteScope = ReturnType<typeof createSendWriteScope>
