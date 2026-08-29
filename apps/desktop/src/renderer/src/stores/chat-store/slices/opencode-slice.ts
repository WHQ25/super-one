import type { StateCreator } from 'zustand'
import type { ChatStore, SessionWriteTarget } from '../types'
import { commitPerSession, resolveWriteScope } from '../index'

export interface OpenCodeSlice {
  setOpenCodeAgentId: (agentId: string | null, target?: SessionWriteTarget) => void
}

export const createOpenCodeSlice: StateCreator<ChatStore, [], [], OpenCodeSlice> = (set, get) => ({
  setOpenCodeAgentId: (agentId, target) => {
    const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath) return
    const provider = session.sessionProvider ?? session.preferredProvider
    if (provider !== 'opencode' || session.openCodeAgentId === agentId) return
    set((state) => commitPerSession(state, target, () => ({ openCodeAgentId: agentId })))

    if (sessionId) {
      void window.agent.broadcastSessionSetting(sessionId, { openCodeAgentId: agentId })
    }
  },
})
