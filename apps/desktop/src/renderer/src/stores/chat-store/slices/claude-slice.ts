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
}

export const createClaudeSlice: StateCreator<ChatStore, [], [], ClaudeSlice> = (set, get) => ({
  setSelectedModel: (model) => {
    const state = get()
    const { activeProject } = state
    const claude = state.harnessResources.claude
    const availableModels = claude?.models ?? []
    const account = claude?.account ?? {}
    if (!activeProject) return
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = getDefaultEffortForModel(modelInfo)
    const session = getActivePerSession(get(), activeProject)
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
