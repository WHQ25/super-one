import { createContext, useContext } from 'react'

export interface SessionScope {
  projectPath: string
  sessionId: string
}

const SessionScopeContext = createContext<SessionScope | null>(null)

export const SessionScopeProvider = SessionScopeContext.Provider

export function useSessionScope(): SessionScope | null {
  return useContext(SessionScopeContext)
}
