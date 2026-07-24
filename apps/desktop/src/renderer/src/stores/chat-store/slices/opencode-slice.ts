import type { StateCreator } from 'zustand'
import type { ChatStore } from '../types'
import { getActivePerSession, updateActivePerSession } from '../index'

export interface OpenCodeSlice {
  setOpenCodeAgentId: (agentId: string | null) => void
}

export const createOpenCodeSlice: StateCreator<ChatStore, [], [], OpenCodeSlice> = (set, get) => ({
  setOpenCodeAgentId: (agentId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const provider = session.sessionProvider ?? session.preferredProvider
    if (provider !== 'opencode' || session.openCodeAgentId === agentId) return
    set((state) => updateActivePerSession(state, () => ({ openCodeAgentId: agentId })))

    const sessionId = get().projectSessions[activeProject]?._activeSessionId
    if (sessionId) {
      void window.agent.broadcastSessionSetting(sessionId, { openCodeAgentId: agentId })
    }
  },
})
