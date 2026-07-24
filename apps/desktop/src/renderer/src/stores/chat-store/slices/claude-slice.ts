import type { StateCreator } from 'zustand'
import type { EffortLevel } from '@superone/shared/agent-types'
import { checkAutoModeEligibility } from '../../../lib/auto-mode-eligibility'
import type { ChatStore, PerSessionState } from '../types'
import { getDefaultEffortForModel } from '../defaults'
import {
  getActivePerSession,
  schedulePrewarm,
  updateActivePerSession,
} from '../index'

/**
 * Claude-harness-specific user setters. None touch Codex state; they
 * mutate the active session's `selectedModel` / `selectedEffort` flags
 * plus call into IPC to broadcast and prewarm.
 */
export interface ClaudeSlice {
  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
  setFastMode: (enabled: boolean) => void
  setSelectedAcpMode: (modeId: string) => void
  refreshClaudeResources: (force?: boolean) => Promise<void>
}

export const createClaudeSlice: StateCreator<ChatStore, [], [], ClaudeSlice> = (set, get) => ({
  /**
   * Re-pull the global Claude resource bundle (models, commands, skills,
   * account). `force` bypasses main's 24h cache — that's the manual
   * "refresh models" path, mirroring refreshCodexModels(true).
   */
  refreshClaudeResources: async (force = false) => {
    if (get().claudeResourcesLoading) return
    set({ claudeResourcesLoading: true })
    try {
      const resources = await window.app.connectClaude(force)
      get().setHarnessResources('claude', resources)
    } catch (error) {
      console.warn('[refreshClaudeResources] Failed:', error)
    } finally {
      set({ claudeResourcesLoading: false })
    }
  },

  setSelectedAcpMode: (modeId) => {
    const { activeProject } = get()
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const provider = session.sessionProvider ?? session.preferredProvider
    if (provider !== 'acp') return
    if (session.selectedAcpModeId === modeId) return
    set((s) => updateActivePerSession(s, () => ({ selectedAcpModeId: modeId })))
    void window.agent.setSessionSettings(activeProject, { mode: modeId })
  },

  setSelectedModel: (model) => {
    const state = get()
    const { activeProject } = state
    if (!activeProject) return
    const session = getActivePerSession(get(), activeProject)
    const provider = session.sessionProvider ?? session.preferredProvider

    if (provider === 'acp' || provider === 'opencode') {
      set((s) => updateActivePerSession(s, () => ({
        selectedModel: model,
        modelUserChosen: true,
        contextWindow: null,
      })))
      void window.agent.setSessionSettings(activeProject, { model })
      return
    }

    const claude = state.harnessResources.claude
    const availableModels = claude?.models ?? []
    const account = claude?.account ?? {}
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = getDefaultEffortForModel(modelInfo)
    const shouldDowngrade =
      session.permissionMode === 'auto' &&
      !checkAutoModeEligibility({
        subscriptionType: account?.subscriptionType,
        apiProvider: account?.apiProvider,
        modelSupportsAutoMode: modelInfo?.supportsAutoMode,
      }).ok
    const patch: Partial<PerSessionState> = {
      selectedModel: model,
      selectedEffort: defaultEffort,
      modelUserChosen: true,
      effortUserChosen: false,
      contextWindow: null,
    }
    if (shouldDowngrade) patch.permissionMode = 'default'
    set((s) => updateActivePerSession(s, () => patch))
    if (shouldDowngrade) void window.agent.setPermissionMode(activeProject, 'default')
    void window.agent.setSessionSettings(activeProject, { model, effort: defaultEffort ?? null })
    if (getActivePerSession(get(), activeProject).draftText.length > 0) {
      schedulePrewarm(get, activeProject)
    }
  },

  setSelectedEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({ selectedEffort: effort, effortUserChosen: true })))
    void window.agent.setSessionSettings(activeProject, { effort: effort ?? null })
    if (getActivePerSession(get(), activeProject).draftText.length > 0) {
      schedulePrewarm(get, activeProject)
    }
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },
})
