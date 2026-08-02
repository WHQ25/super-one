import type { StateCreator } from 'zustand'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import { checkAutoModeEligibility } from '../../../lib/auto-mode-eligibility'
import type { ChatStore, PerSessionState } from '../types'
import { getDefaultEffortForModel } from '../defaults'
import {
  applyDefaultModel,
  getActivePerSession,
  getProject,
  triggerPrewarm,
  updateActivePerSession,
  updateProjectState,
} from '../index'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { codexModelCacheKey } from '../helpers/codex-model-cache'

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
  /** Load Claude models for a project (remote → node provider store; local → connectClaude). */
  loadClaudeModels: (projectPath: string, apiProviderId: string | null, force?: boolean) => Promise<ModelOption[]>
}

export const createClaudeSlice: StateCreator<ChatStore, [], [], ClaudeSlice> = (set, get) => ({
  /**
   * Re-pull Claude resources for the active project.
   * Remote: models only from the node provider store (project.claudeModels).
   * Local: desktop connectClaude bundle into harnessResources.
   */
  refreshClaudeResources: async (force = false) => {
    const { activeProject } = get()
    if (!activeProject) return
    const remote = parseRemoteProjectKey(activeProject)
    if (remote) {
      // In-flight or already have models for this provider → no-op (unless force).
      if (get().claudeResourcesLoading) return
      const project = getProject(get(), activeProject)
      const sessionId = project._activeSessionId
      const apiProviderId = sessionId ? (project._sessions[sessionId]?.apiProviderId ?? null) : null
      const cacheKey = codexModelCacheKey(apiProviderId)
      if (!force && (project.claudeModelsByProvider?.[cacheKey]?.length ?? 0) > 0) {
        // Ensure active catalog points at cached list without a network round-trip.
        if (project.claudeModels !== project.claudeModelsByProvider![cacheKey]) {
          set((s) =>
            updateProjectState(s, activeProject, () => ({
              claudeModels: project.claudeModelsByProvider![cacheKey]!,
              claudeModelsLoading: false,
            })),
          )
        }
        return
      }
      set({ claudeResourcesLoading: true })
      try {
        await get().loadClaudeModels(activeProject, apiProviderId, force)
      } catch (error) {
        console.warn('[refreshClaudeResources] remote Failed:', error)
      } finally {
        set({ claudeResourcesLoading: false })
      }
      return
    }
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

  loadClaudeModels: async (projectPath, apiProviderId, force = false) => {
    const remote = parseRemoteProjectKey(projectPath)
    if (!remote) {
      const resources = await window.app.connectClaude(force)
      get().setHarnessResources('claude', resources)
      return resources.models ?? []
    }

    const cacheKey = codexModelCacheKey(apiProviderId)
    const project0 = get().projectSessions[projectPath]
    if (!project0) {
      try {
        const models = (await window.environment.listRemoteModels(
          remote.connectionId,
          'claude',
          apiProviderId,
        )) as ModelOption[]
        return Array.isArray(models) ? models : []
      } catch {
        return []
      }
    }

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
        let sessions = project._sessions
        if (appliesToActiveSession && activeSessionId && activeSession && !activeSession.selectedModel && models.length > 0) {
          const updated = { ...activeSession }
          applyDefaultModel(updated, models)
          sessions = { ...project._sessions, [activeSessionId]: updated }
        }
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...project,
              claudeModelsByProvider: { ...(project.claudeModelsByProvider ?? {}), [cacheKey]: models },
              ...(appliesToActiveSession
                ? { claudeModels: models, claudeModelsLoading: false, _sessions: sessions }
                : { claudeModelsLoading: false }),
            },
          },
        }
      })
    }

    const cached = project0.claudeModelsByProvider?.[cacheKey]
    if (!force && cached) {
      applyModels(cached)
      return cached
    }

    if (isActiveProvider(project0)) {
      set((s) => updateProjectState(s, projectPath, () => ({ claudeModelsLoading: true })))
    }
    try {
      const models = (await window.environment.listRemoteModels(
        remote.connectionId,
        'claude',
        apiProviderId,
      )) as ModelOption[]
      const list = Array.isArray(models) ? models : []
      applyModels(list)
      return list
    } catch (error) {
      set((s) => {
        const project = s.projectSessions[projectPath]
        return project
          ? updateProjectState(s, projectPath, () => ({ claudeModelsLoading: false }))
          : {}
      })
      console.warn('[loadClaudeModels] remote failed:', error)
      return []
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

    const isRemote = !!parseRemoteProjectKey(activeProject)
    const claude = state.harnessResources.claude
    const availableModels = isRemote
      ? (getProject(state, activeProject).claudeModels ?? [])
      : (claude?.models ?? [])
    const account = isRemote ? {} : (claude?.account ?? {})
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
    // Remote has no Claude subscription account — do not auto-downgrade permission mode.
    if (shouldDowngrade && !isRemote) patch.permissionMode = 'default'
    set((s) => updateActivePerSession(s, () => patch))
    // Desktop SessionManager does not own remote node drafts — skip local IPC.
    if (!isRemote) {
      if (shouldDowngrade) void window.agent.setPermissionMode(activeProject, 'default')
      void window.agent.setSessionSettings(activeProject, { model, effort: defaultEffort ?? null })
      if (getActivePerSession(get(), activeProject).draftText.length > 0) {
        triggerPrewarm(get(), activeProject)
      }
    }
  },

  setSelectedEffort: (effort) => {
    const { activeProject } = get()
    if (!activeProject) return
    set((s) => updateActivePerSession(s, () => ({ selectedEffort: effort, effortUserChosen: true })))
    if (parseRemoteProjectKey(activeProject)) return
    void window.agent.setSessionSettings(activeProject, { effort: effort ?? null })
    if (getActivePerSession(get(), activeProject).draftText.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },
})
