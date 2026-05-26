import type { StateCreator } from 'zustand'
import type { CodexCollaborationMode, CodexPermissionPreset, CodexReasoningEffort } from '@superone/shared/agent-types'
import { resolveCodexReasoningEffort } from '../helpers/codex-helpers'
import type { ChatStore } from '../types'
import { createDefaultPerSessionState } from '../defaults'
import {
  _getEffectiveSessionId,
  getActivePerSession,
  getProject,
  resolveSessionCodexSelection,
  saveLastCodexSelection,
  updateActivePerSession,
  updateProjectState,
} from '../index'

/**
 * Codex-harness-specific actions: model/effort/permission/collaboration
 * mode setters plus model/skills refresh. All scoped to the active
 * project; no Claude state mutation.
 */
export interface CodexSlice {
  setSelectedCodexModel: (model: string) => void
  setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort) => void
  setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset) => void
  setSelectedCodexCollaborationMode: (mode: CodexCollaborationMode) => void
  refreshCodexModels: (force?: boolean) => Promise<void>
  refreshCodexSkills: (projectPath?: string) => Promise<void>
}

export const createCodexSlice: StateCreator<ChatStore, [], [], CodexSlice> = (set, get) => ({
  setSelectedCodexModel: (model) => {
    const { activeProject } = get()
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const selectedModel = proj.codexModels.find((entry) => entry.id === model)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel)
    saveLastCodexSelection(model, selectedEffort)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexModel: model,
      selectedCodexReasoningEffort: selectedEffort,
      codexModelUserChosen: true,
      codexReasoningEffortUserChosen: false,
    })))
    const sid = _getEffectiveSessionId(getProject(get(), activeProject))
    if (sid) {
      void window.agent.broadcastSessionSetting(sid, {
        selectedCodexModel: model,
        selectedCodexReasoningEffort: selectedEffort ?? null,
      })
    }
  },

  setSelectedCodexReasoningEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const sess = getActivePerSession(get())
    const selectedModel = proj.codexModels.find((entry) => entry.id === sess.selectedCodexModel)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel, effort)
    saveLastCodexSelection(sess.selectedCodexModel, selectedEffort)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexReasoningEffort: selectedEffort,
      codexReasoningEffortUserChosen: true,
    })))
    const sid = _getEffectiveSessionId(getProject(get(), activeProject))
    if (sid) {
      void window.agent.broadcastSessionSetting(sid, {
        selectedCodexReasoningEffort: selectedEffort ?? null,
      })
    }
  },

  setSelectedCodexPermissionPreset: (preset) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexPermissionPreset: preset,
    })))
    const sid = _getEffectiveSessionId(getProject(get(), activeProject))
    if (sid) {
      void window.agent.broadcastSessionSetting(sid, { selectedCodexPermissionPreset: preset })
    }
  },

  setSelectedCodexCollaborationMode: (mode) => {
    const { activeProject } = get()
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const sessionId = _getEffectiveSessionId(project)
    set((s) => updateActivePerSession(s, () => ({
      selectedCodexCollaborationMode: mode,
      codexPlanRejectHintActive: false,
    })))
    if (sessionId) {
      window.app.codexCollaborationModeChange(activeProject, sessionId, mode)
      void window.agent.broadcastSessionSetting(sessionId, { selectedCodexCollaborationMode: mode })
    }
  },

  refreshCodexModels: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return

    const project0 = getProject(get(), activeProject)
    const activeSid0 = project0._activeSessionId
    const apiProviderId = activeSid0
      ? (project0._sessions[activeSid0]?.apiProviderId ?? null)
      : null

    const applyModels = (models: typeof project0.codexModels, clearLoading: boolean) => {
      set((s) => {
        const proj = getProject(s, activeProject)
        const activeSid = proj._activeSessionId
        const sess = activeSid ? (proj._sessions[activeSid] ?? createDefaultPerSessionState()) : createDefaultPerSessionState()
        const selected = resolveSessionCodexSelection(
          models,
          sess.selectedCodexModel,
          sess.selectedCodexReasoningEffort,
        )
        const updatedSessions = activeSid
          ? {
              ...proj._sessions,
              [activeSid]: {
                ...sess,
                selectedCodexModel: selected.modelId,
                selectedCodexReasoningEffort: selected.reasoningEffort,
              },
            }
          : proj._sessions
        return {
          projectSessions: {
            ...s.projectSessions,
            [activeProject]: {
              ...proj,
              codexModels: models,
              ...(clearLoading ? { codexModelsLoading: false } : {}),
              _sessions: updatedSessions,
            },
          },
          harnessResources: { ...s.harnessResources, codex: { models, prompts: s.harnessResources.codex?.prompts ?? [] } },
        }
      })
    }

    const revalidate = async () => {
      try {
        const fresh = await window.app.codexListModels(activeProject, apiProviderId, true)
        applyModels(fresh, true)
      } catch (error) {
        console.warn('[refreshCodexModels] revalidate failed:', error)
        set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: false })))
      }
    }

    if (force) {
      set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: true })))
      await revalidate()
      return
    }

    if (project0.codexModelsLoading) return

    set((s) => updateProjectState(s, activeProject, () => ({ codexModelsLoading: true })))
    try {
      const cached = await window.app.codexListModels(activeProject, apiProviderId, false)
      applyModels(cached, false)
    } catch (error) {
      console.warn('[refreshCodexModels] Failed:', error)
    }
    void revalidate()
  },

  refreshCodexSkills: async (projectPath) => {
    const target = projectPath ?? get().activeProject
    if (!target) return
    const current = get().projectSessions[target]
    if (current?._codexSkillsLoading) return
    set((s) => updateProjectState(s, target, () => ({ _codexSkillsLoading: true })))
    try {
      const skills = await window.app.codexListSkills(target)
      set((s) => updateProjectState(s, target, () => ({ _codexSkills: skills, _codexSkillsLoading: false })))
    } catch (error) {
      console.warn('[refreshCodexSkills] Failed:', error)
      set((s) => updateProjectState(s, target, () => ({ _codexSkillsLoading: false })))
    }
  },
})
