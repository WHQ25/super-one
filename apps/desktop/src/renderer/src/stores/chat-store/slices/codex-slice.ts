import type { StateCreator } from 'zustand'
import type { CodexCollaborationMode, CodexPermissionPreset, CodexReasoningEffort, ModelOption } from '@superone/shared/agent-types'
import { resolveCodexReasoningEffort } from '../helpers/codex-helpers'
import { codexModelCacheKey } from '../helpers/codex-model-cache'
import type { ChatStore, SessionWriteTarget } from '../types'
import {
  commitPerSession,
  getProject,
  resolveSessionCodexSelection,
  resolveWriteScope,
  saveLastCodexSelection,
  updateProjectState,
} from '../index'

/**
 * Codex-harness-specific actions: model/effort/permission/collaboration
 * mode setters plus model/skills refresh. No Claude state mutation.
 *
 * The setters take an optional `SessionWriteTarget` for the same reason the
 * Claude ones do: the composer is per-pane (mosaic tile, side chat), so
 * "the active session" is not the session whose picker the user just used.
 */
export interface CodexSlice {
  setSelectedCodexModel: (model: string, target?: SessionWriteTarget) => void
  setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort, target?: SessionWriteTarget) => void
  setSelectedCodexServiceTier: (tier: string | null, target?: SessionWriteTarget) => void
  setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset, target?: SessionWriteTarget) => void
  setSelectedCodexCollaborationMode: (mode: CodexCollaborationMode, target?: SessionWriteTarget) => void
  loadCodexModels: (projectPath: string, apiProviderId: string | null, force?: boolean) => Promise<ModelOption[]>
  refreshCodexModels: (force?: boolean) => Promise<void>
  refreshCodexSkills: (projectPath?: string) => Promise<void>
}

export const createCodexSlice: StateCreator<ChatStore, [], [], CodexSlice> = (set, get) => ({
  setSelectedCodexModel: (model, target) => {
    const { projectPath: activeProject, sessionId, session: activeSession } = resolveWriteScope(get(), target)
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const selectedModel = proj.codexModels.find((entry) => entry.id === model)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel)
    const selectedServiceTier = selectedModel?.serviceTiers?.some((tier) => tier.id === activeSession.selectedCodexServiceTier)
      ? activeSession.selectedCodexServiceTier
      : (selectedModel?.defaultServiceTier ?? null)
    saveLastCodexSelection(model, selectedEffort)
    set((s) => commitPerSession(s, target, () => ({
      selectedCodexModel: model,
      selectedCodexReasoningEffort: selectedEffort,
      selectedCodexServiceTier: selectedServiceTier,
      codexModelUserChosen: true,
      codexReasoningEffortUserChosen: false,
    })))
    if (sessionId) {
      void window.agent.broadcastSessionSetting(sessionId, {
        selectedCodexModel: model,
        selectedCodexReasoningEffort: selectedEffort ?? null,
        selectedCodexServiceTier: selectedServiceTier,
      })
    }
  },

  setSelectedCodexReasoningEffort: (effort, target) => {
    const { projectPath: activeProject, sessionId, session: sess } = resolveWriteScope(get(), target)
    if (!activeProject) return
    const proj = getProject(get(), activeProject)
    const selectedModel = proj.codexModels.find((entry) => entry.id === sess.selectedCodexModel)
    const selectedEffort = resolveCodexReasoningEffort(selectedModel, effort)
    saveLastCodexSelection(sess.selectedCodexModel, selectedEffort)
    set((s) => commitPerSession(s, target, () => ({
      selectedCodexReasoningEffort: selectedEffort,
      codexReasoningEffortUserChosen: true,
    })))
    if (sessionId) {
      void window.agent.broadcastSessionSetting(sessionId, {
        selectedCodexReasoningEffort: selectedEffort ?? null,
      })
    }
  },

  setSelectedCodexServiceTier: (tier, target) => {
    const { projectPath: activeProject, sessionId, session } = resolveWriteScope(get(), target)
    if (!activeProject) return
    const project = getProject(get(), activeProject)
    const model = project.codexModels.find((entry) => entry.id === session.selectedCodexModel)
    const selectedTier = tier && model?.serviceTiers?.some((entry) => entry.id === tier) ? tier : null
    set((state) => commitPerSession(state, target, () => ({ selectedCodexServiceTier: selectedTier })))
    if (sessionId) void window.agent.broadcastSessionSetting(sessionId, { selectedCodexServiceTier: selectedTier })
  },

  setSelectedCodexPermissionPreset: (preset, target) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject) return
    set((s) => commitPerSession(s, target, () => ({
      selectedCodexPermissionPreset: preset,
    })))
    if (sessionId) {
      void window.agent.broadcastSessionSetting(sessionId, { selectedCodexPermissionPreset: preset })
    }
  },

  setSelectedCodexCollaborationMode: (mode, target) => {
    const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
    if (!activeProject) return
    set((s) => commitPerSession(s, target, () => ({
      selectedCodexCollaborationMode: mode,
      codexPlanRejectHintActive: false,
    })))
    if (sessionId) {
      window.app.codexCollaborationModeChange(activeProject, sessionId, mode)
      void window.agent.broadcastSessionSetting(sessionId, { selectedCodexCollaborationMode: mode })
    }
  },

  loadCodexModels: async (projectPath, apiProviderId, force = false) => {
    const cacheKey = codexModelCacheKey(apiProviderId)
    const project0 = get().projectSessions[projectPath]
    if (!project0) return window.app.codexListModels(projectPath, apiProviderId, force)

    const isActiveProvider = (project: typeof project0): boolean => {
      const sessionId = project._activeSessionId
      const session = sessionId ? project._sessions[sessionId] : undefined
      return (session?.apiProviderId ?? null) === apiProviderId
    }

    const applyModels = (models: ModelOption[]) => {
      set((s) => {
        const project = s.projectSessions[projectPath]
        if (!project) return {}
        const activeSessionId = project._activeSessionId
        const activeSession = activeSessionId ? project._sessions[activeSessionId] : undefined
        const appliesToActiveSession = isActiveProvider(project)
        const selected = appliesToActiveSession && activeSession
          ? resolveSessionCodexSelection(models, activeSession.selectedCodexModel, activeSession.selectedCodexReasoningEffort)
          : null
        const selectedModel = selected ? models.find((model) => model.id === selected.modelId) : undefined
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...project,
              codexModelsByProvider: { ...project.codexModelsByProvider, [cacheKey]: models },
              ...(appliesToActiveSession ? { codexModels: models, codexModelsLoading: false } : {}),
              ...(activeSessionId && activeSession && selected
                ? {
                    _sessions: {
                      ...project._sessions,
                      [activeSessionId]: {
                        ...activeSession,
                        selectedCodexModel: selected.modelId,
                        selectedCodexReasoningEffort: selected.reasoningEffort,
                        selectedCodexServiceTier: selectedModel?.serviceTiers?.some((tier) => tier.id === activeSession.selectedCodexServiceTier)
                          ? activeSession.selectedCodexServiceTier
                          : (selectedModel?.defaultServiceTier ?? null),
                      },
                    },
                  }
                : {}),
            },
          },
          ...(apiProviderId === null
            ? { harnessResources: { ...s.harnessResources, codex: { models, prompts: s.harnessResources.codex?.prompts ?? [] } } }
            : {}),
        }
      })
    }

    const cached = project0.codexModelsByProvider[cacheKey]
    if (!force && cached) {
      applyModels(cached)
      return cached
    }

    if (isActiveProvider(project0)) {
      set((s) => updateProjectState(s, projectPath, () => ({ codexModelsLoading: true })))
    }
    try {
      const models = await window.app.codexListModels(projectPath, apiProviderId, force)
      applyModels(models)
      return models
    } catch (error) {
      set((s) => {
        const project = s.projectSessions[projectPath]
        return project && isActiveProvider(project)
          ? updateProjectState(s, projectPath, () => ({ codexModelsLoading: false }))
          : {}
      })
      throw error
    }
  },

  refreshCodexModels: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return

    try {
      const project = getProject(get(), activeProject)
      const sessionId = project._activeSessionId
      const apiProviderId = sessionId ? (project._sessions[sessionId]?.apiProviderId ?? null) : null
      await get().loadCodexModels(activeProject, apiProviderId, force)
    } catch (error) {
      console.warn('[refreshCodexModels] Failed:', error)
    }
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
