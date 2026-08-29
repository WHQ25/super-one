import type { StateCreator } from 'zustand'
import { shallow } from 'zustand/shallow'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import {
  findCursorEffortParam,
  normalizeEffortValue,
} from '@superone/cursor/cursor-model-selection'
import type { ChatStore, SessionWriteTarget } from '../types'
import { getDefaultEffortForModel } from '../defaults'
import {
  applyDefaultModel,
  commitPerSession,
  getProject,
  getScopedPerSession,
  resolveWriteScope,
  triggerPrewarm,
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
 * mutate one session's `selectedModel` / `selectedEffort` flags plus call
 * into IPC to broadcast and prewarm.
 *
 * Every setter takes an optional `SessionWriteTarget`. The composer that hosts
 * the model picker exists once per *pane* — a mosaic tile, and the side chat
 * docked in the activity panel — while the picker's reads go through the
 * scope-aware `useActiveSession`. Writing to the project's active session would
 * therefore send a side chat's model change into the conversation it forked
 * from, and leave the side chat showing something it is not running.
 */
export interface ClaudeSlice {
  setSelectedModel: (model: string, target?: SessionWriteTarget) => void
  setSelectedEffort: (effort?: EffortLevel, target?: SessionWriteTarget) => void
  setCursorModelParams: (params: Record<string, string>, target?: SessionWriteTarget) => void
  setCursorModelParam: (id: string, value: string, target?: SessionWriteTarget) => void
  setFastMode: (enabled: boolean) => void
  setSelectedAcpMode: (modeId: string, target?: SessionWriteTarget) => void
  refreshClaudeResources: (force?: boolean) => Promise<void>
  refreshCursorSlashItems: (projectPath?: string) => Promise<void>
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

  setSelectedAcpMode: (modeId, target) => {
    const { projectPath, ipcSessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath) return
    const provider = session.sessionProvider ?? session.preferredProvider
    if (provider !== 'acp') return
    if (session.selectedAcpModeId === modeId) return
    set((s) => commitPerSession(s, target, () => ({ selectedAcpModeId: modeId })))
    void window.agent.setSessionSettings(projectPath, { mode: modeId }, ipcSessionId)
  },

  setSelectedModel: (model, target) => {
    const state = get()
    const { projectPath: activeProject, ipcSessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
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
          const live = getScopedPerSession(get(), target)
          if ((live.sessionProvider ?? live.preferredProvider) !== 'cursor') return
          if (live.selectedModel !== model) return
          const resolved = applyResolved()
          set((s) => commitPerSession(s, target, () => ({
            cursorModelParams: resolved.params,
            selectedEffort: resolved.nextEffort,
            effortUserChosen: true,
          })))
          if (resolved.nextEffort && !parseRemoteProjectKey(activeProject)) {
            void window.agent.setSessionSettings(activeProject, { effort: resolved.nextEffort }, ipcSessionId)
          }
        })
      }
      set((s) => commitPerSession(s, target, () => patch))
      void window.agent.setSessionSettings(activeProject, {
        model,
        ...(provider === 'cursor' && patch.selectedEffort ? { effort: patch.selectedEffort } : {}),
      }, ipcSessionId)
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
    set((s) => commitPerSession(s, target, () => ({
      selectedModel: model,
      selectedEffort: defaultEffort,
      modelUserChosen: true,
      effortUserChosen: false,
      contextWindow: null,
    })))
    // Desktop SessionManager does not own remote node drafts — skip local IPC.
    if (!isRemote) {
      void window.agent.setSessionSettings(activeProject, { model, effort: defaultEffort ?? null }, ipcSessionId)
      if (getScopedPerSession(get(), target).draftText.length > 0) {
        triggerPrewarm(get(), activeProject)
      }
    }
  },

  setSelectedEffort: (effort, target) => {
    const state = get()
    const { projectPath: activeProject, ipcSessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
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
    set((s) => commitPerSession(s, target, () => patch))
    // Desktop SessionManager does not own remote node drafts — skip local IPC.
    if (!parseRemoteProjectKey(activeProject)) {
      void window.agent.setSessionSettings(activeProject, { effort: effort ?? null }, ipcSessionId)
      if (getScopedPerSession(get(), target).draftText.length > 0) {
        triggerPrewarm(get(), activeProject)
      }
    }
  },

  setCursorModelParams: (params, target) => {
    const state = get()
    const { projectPath: activeProject, session } = resolveWriteScope(state, target)
    if (!activeProject) return
    // An identical map still mints a new object reference, which re-arms any
    // effect that both depends on cursorModelParams and writes it. With an
    // empty seed map (degraded Cursor catalog: params present, values missing)
    // that effect never satisfies its own guard and storms React into #185.
    if (shallow(session.cursorModelParams, params)) return
    set((s) => commitPerSession(s, target, () => ({ cursorModelParams: params })))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, params)
    }
  },

  setCursorModelParam: (id, value, target) => {
    const state = get()
    const { projectPath: activeProject, ipcSessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
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
    set((s) => commitPerSession(s, target, () => patch))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, nextParams)
    }
    if (patch.selectedEffort && !parseRemoteProjectKey(activeProject)) {
      void window.agent.setSessionSettings(activeProject, { effort: patch.selectedEffort }, ipcSessionId)
    }
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },

  refreshCursorSlashItems: async (projectPath) => {
    const target = projectPath ?? get().activeProject
    if (!target || parseRemoteProjectKey(target)) return
    const current = get().projectSessions[target]
    if (current?._cursorSlashItemsLoading) return
    set((s) => updateProjectState(s, target, () => ({ _cursorSlashItemsLoading: true })))
    try {
      const items = await window.app.cursorListSlashItems(target)
      set((s) => updateProjectState(s, target, () => ({
        _cursorSlashItems: Array.isArray(items) ? items : [],
        _cursorSlashItemsLoading: false,
      })))
    } catch (error) {
      console.warn('[refreshCursorSlashItems] Failed:', error)
      set((s) => updateProjectState(s, target, () => ({ _cursorSlashItemsLoading: false })))
    }
  },
})
