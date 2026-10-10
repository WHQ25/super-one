import { createContext, useContext, type ReactNode } from 'react'
import type { DetailClient } from '@superone/chat-core'

/**
 * Where a summarized row's detail comes from: the frontend's detail client
 * and the session the rows belong to. The phone document provides its
 * native-bridge client; the desktop renderer provides its IPC client per
 * session view. Without a scope, deferred rows have nothing to load.
 */
export interface DetailScope {
  client: DetailClient
  environmentId: string
  sessionId: string
}

const DetailScopeContext = createContext<DetailScope | null>(null)

export function DetailScopeProvider({ scope, children }: { scope: DetailScope | null; children: ReactNode }) {
  return <DetailScopeContext.Provider value={scope}>{children}</DetailScopeContext.Provider>
}

export function useDetailScope(): DetailScope | null {
  return useContext(DetailScopeContext)
}
