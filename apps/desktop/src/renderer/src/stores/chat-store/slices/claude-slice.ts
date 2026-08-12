import type { StateCreator } from 'zustand'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import {
  findCursorEffortParam,
  normalizeEffortValue,
} from '@superone/cursor/cursor-model-selection'
import type { ChatStore } from '../types'
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
import {
  ensureCursorHarnessModelPrefsLoaded,
  persistCursorHarnessModelParams,
  resolveCursorHarnessModelParams,
} from '../helpers/cursor-model-prefs'

/**
 * Claude-harness-specific user setters. None touch Codex state; they
 * mutate the active session's `selectedModel` / `selectedEffort` flags
 * plus call into IPC to broadcast and prewarm.
 */
export interface ClaudeSlice {
  setSelectedModel: (model: string) => void
  setSelectedEffort: (effort?: EffortLevel) => void
  setCursorModelParams: (params: Record<string, string>) => void
  setCursorModelParam: (id: string, value: string) => void
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
        // Prefer node harness.resources (full discovery); fall back to listModels.
        const { fetchRemoteHarnessResourcesForProject, extractClaudeModels } = await import(
          '@/lib/remote-harness-resources'
        )
        const bundle = await fetchRemoteHarnessResourcesForProject(projectPath, {
          harnessId: 'claude',
          apiProviderId,
        })
        const fromResources = extractClaudeModels(bundle)
        if (fromResources.length > 0) return fromResources
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
        const claudeRes = s.harnessResources.claude
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
          // Keep global claude shell for selectors that still read harnessResources on remote.
          ...(appliesToActiveSession && claudeRes
            ? {
                harnessResources: {
                  ...s.harnessResources,
                  claude: { ...claudeRes, models },
                },
              }
            : {}),
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
      const { fetchRemoteHarnessResourcesForProject, extractClaudeModels } = await import(
        '@/lib/remote-harness-resources'
      )
      const bundle = await fetchRemoteHarnessResourcesForProject(projectPath, {
        harnessId: 'claude',
        apiProviderId,
      })
      let list = extractClaudeModels(bundle)
      // Apply skills/commands/agents from node discovery into project state.
      if (bundle?.claude) {
        const claude = bundle.claude
        set((s) => {
          const project = s.projectSessions[projectPath]
          if (!project) return {}
          return {
            harnessResources: {
              ...s.harnessResources,
              claude: {
                models: list,
                account: claude.account ?? {},
                slashCommands: claude.slashCommands ?? [],
                skills: claude.skills ?? [],
                commands: claude.commands ?? [],
                agents: claude.agents ?? [],
                outputStyles: claude.outputStyles ?? [],
              },
            },
            projectSessions: {
              ...s.projectSessions,
              [projectPath]: {
                ...project,
                agents: claude.agents ?? project.agents,
                _projectSkills: claude.skills ?? project._projectSkills,
                _projectCommands: claude.commands ?? project._projectCommands,
              },
            },
          }
        })
      }
      if (list.length === 0) {
        const models = (await window.environment.listRemoteModels(
          remote.connectionId,
          'claude',
          apiProviderId,
        )) as ModelOption[]
        list = Array.isArray(models) ? models : []
      }
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

    if (provider === 'acp' || provider === 'opencode' || provider === 'cursor') {
      const patch: Partial<import('../types').PerSessionState> = {
        selectedModel: model,
        modelUserChosen: true,
        contextWindow: null,
      }
      if (provider === 'cursor') {
        const cursorModels = state.harnessResources.cursor?.models ?? []
        const cursorModel = cursorModels.find((m) => m.id === model)
        // Persist outgoing session params into harness config before switching.
        if (
          session.selectedModel
          && session.selectedModel !== model
          && Object.keys(session.cursorModelParams).length > 0
        ) {
          persistCursorHarnessModelParams(session.selectedModel, session.cursorModelParams)
        }
        const applyResolved = () => {
          const params = resolveCursorHarnessModelParams(model, cursorModel)
          const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
          const nextEffort = effortParam
            ? (normalizeEffortValue(params[effortParam.id] ?? '') ?? undefined)
            : undefined
          return { params, nextEffort }
        }
        const { params, nextEffort } = applyResolved()
        patch.cursorModelParams = params
        patch.selectedEffort = nextEffort
        patch.effortUserChosen = true
        void ensureCursorHarnessModelPrefsLoaded().then(() => {
          const live = getActivePerSession(get(), activeProject)
          if ((live.sessionProvider ?? live.preferredProvider) !== 'cursor') return
          if (live.selectedModel !== model) return
          const resolved = applyResolved()
          set((s) => updateActivePerSession(s, () => ({
            cursorModelParams: resolved.params,
            selectedEffort: resolved.nextEffort,
            effortUserChosen: true,
          })))
          if (resolved.nextEffort && !parseRemoteProjectKey(activeProject)) {
            void window.agent.setSessionSettings(activeProject, { effort: resolved.nextEffort })
          }
        })
      }
      set((s) => updateActivePerSession(s, () => patch))
      void window.agent.setSessionSettings(activeProject, {
        model,
        ...(provider === 'cursor' && patch.selectedEffort ? { effort: patch.selectedEffort } : {}),
      })
      return
    }

    const isRemote = !!parseRemoteProjectKey(activeProject)
    const claude = state.harnessResources.claude
    const availableModels = isRemote
      ? (getProject(state, activeProject).claudeModels ?? [])
      : (claude?.models ?? [])
    const modelInfo = availableModels.find((m) => m.id === model)
    const defaultEffort = getDefaultEffortForModel(modelInfo)
    // Keep permissionMode as-is when switching models — SuperOne no longer
    // client-gates Auto Mode (local or remote). Claude runtime enforces support.
    set((s) => updateActivePerSession(s, () => ({
      selectedModel: model,
      selectedEffort: defaultEffort,
      modelUserChosen: true,
      effortUserChosen: false,
      contextWindow: null,
    })))
    // Desktop SessionManager does not own remote node drafts — skip local IPC.
    if (!isRemote) {
      void window.agent.setSessionSettings(activeProject, { model, effort: defaultEffort ?? null })
      if (getActivePerSession(get(), activeProject).draftText.length > 0) {
        triggerPrewarm(get(), activeProject)
      }
    }
  },

  setSelectedEffort: (effort) => {
    const state = get()
    const { activeProject } = state
    if (!activeProject) return
    const session = getActivePerSession(state, activeProject)
    const provider = session.sessionProvider ?? session.preferredProvider
    const patch: Partial<import('../types').PerSessionState> = {
      selectedEffort: effort,
      effortUserChosen: true,
    }
    if (provider === 'cursor' && effort) {
      const cursorModel = state.harnessResources.cursor?.models.find((m) => m.id === session.selectedModel)
      const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
      if (effortParam) {
        const raw = effortParam.values.find((v) =>
          v.value === effort || normalizeEffortValue(v.value) === effort,
        )?.value
        if (raw) {
          const nextParams = { ...session.cursorModelParams, [effortParam.id]: raw }
          patch.cursorModelParams = nextParams
          if (session.selectedModel) {
            persistCursorHarnessModelParams(session.selectedModel, nextParams)
          }
        }
      }
    }
    set((s) => updateActivePerSession(s, () => patch))
    // Desktop SessionManager does not own remote node drafts — skip local IPC.
    if (!parseRemoteProjectKey(activeProject)) {
      void window.agent.setSessionSettings(activeProject, { effort: effort ?? null })
      if (getActivePerSession(get(), activeProject).draftText.length > 0) {
        triggerPrewarm(get(), activeProject)
      }
    }
  },

  setCursorModelParams: (params) => {
    const state = get()
    const { activeProject } = state
    if (!activeProject) return
    const session = getActivePerSession(state, activeProject)
    set((s) => updateActivePerSession(s, () => ({ cursorModelParams: params })))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, params)
    }
  },

  setCursorModelParam: (id, value) => {
    const state = get()
    const { activeProject } = state
    if (!activeProject) return
    const session = getActivePerSession(state, activeProject)
    const nextParams = { ...session.cursorModelParams, [id]: value }
    const patch: Partial<import('../types').PerSessionState> = { cursorModelParams: nextParams }
    const cursorModel = state.harnessResources.cursor?.models.find((m) => m.id === session.selectedModel)
    const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
    if (effortParam && effortParam.id === id) {
      const nextEffort = normalizeEffortValue(value)
      if (nextEffort) {
        patch.selectedEffort = nextEffort
        patch.effortUserChosen = true
      }
    }
    set((s) => updateActivePerSession(s, () => patch))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, nextParams)
    }
    if (patch.selectedEffort && !parseRemoteProjectKey(activeProject)) {
      void window.agent.setSessionSettings(activeProject, { effort: patch.selectedEffort })
    }
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },
})
