import { toast } from 'sonner'
import type { StateCreator } from 'zustand'
import { isAcpProtocolHarness } from '@superone/shared/acp-brand'
import { isAcpEffortConfigId } from '@superone/shared/effort-labels'
import type { ChatStore, SessionWriteTarget } from '../types'
import { commitPerSession, resolveWriteScope } from '../index'
import { patchSessionSettings, pushSettings } from '@/lib/session-client'

export interface AcpSlice {
  setSelectedAcpMode: (modeId: string, target?: SessionWriteTarget) => void
  setSelectedAcpContextWindow: (contextWindow: number, target?: SessionWriteTarget) => Promise<boolean>
}

export const createAcpSlice: StateCreator<ChatStore, [], [], AcpSlice> = (set, get) => ({
  setSelectedAcpMode: (modeId, target) => {
    const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath) return
    const provider = session.sessionProvider ?? session.preferredProvider
    if (!isAcpProtocolHarness(provider)) return
    if (session.selectedAcpModeId === modeId) return
    const isEffort = isAcpEffortConfigId(session.acpModeConfigId)
    set((s) => commitPerSession(s, target, () => ({
      selectedAcpModeId: modeId,
      ...(isEffort ? { effortUserChosen: true } : {}),
    })))
    pushSettings(projectPath, sessionId, session, { mode: modeId })
  },

  setSelectedAcpContextWindow: async (contextWindow, target) => {
    const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath) return false
    const provider = session.sessionProvider ?? session.preferredProvider
    if (!isAcpProtocolHarness(provider)) return false
    const previous = session.selectedAcpContextWindow ?? null
    if (previous === contextWindow) return true
    set((s) => commitPerSession(s, target, () => ({ selectedAcpContextWindow: contextWindow })))
    try {
      if (sessionId) await patchSessionSettings(projectPath, sessionId, session, { contextWindow })
      return true
    } catch (err) {
      set((s) => commitPerSession(s, target, () => ({ selectedAcpContextWindow: previous })))
      toast.error(err instanceof Error ? err.message : String(err))
      return false
    }
  },
})
