import type { StateCreator } from 'zustand'
import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import { isAcpProtocolHarness } from '@superone/shared/acp-brand'
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
import { pushSettings } from '@/lib/session-client'
import { codexModelCacheKey } from '../helpers/codex-model-cache'
import { resolveAcpModeForModelSwitch } from '../harness/acp-handler'
import { applyCursorModelSelection, resolveCursorEffortParamPatch } from './cursor-slice'

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
  /** Claude Ultracode for this session: every substantive turn runs as a multi-agent workflow. */
  setClaudeFastMode: (enabled: boolean, target?: SessionWriteTarget) => void
  setUltracode: (enabled: boolean, target?: SessionWriteTarget) => void
  setFastMode: (enabled: boolean) => void
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
      const project = getProject(get(), activeProject)
      const selected = project._activeSessionId ? project._sessions[project._activeSessionId]?.apiProviderId : null
      const resources = selected ? await window.app.connectClaude(force, selected) : await window.app.connectClaude(force)
      const current = getProject(get(), activeProject)
      const currentId = current._activeSessionId ? current._sessions[current._activeSessionId]?.apiProviderId : null
      if (currentId === selected) get().setHarnessResources('claude', resources)
    } catch (error) {
      console.warn('[refreshClaudeResources] Failed:', error)
    } finally {
      set({ claudeResourcesLoading: false })
    }
  },

  loadClaudeModels: async (projectPath, apiProviderId, force = false) => {
    const remote = parseRemoteProjectKey(projectPath)
    if (!remote) {
      const resources = apiProviderId ? await window.app.connectClaude(force, apiProviderId) : await window.app.connectClaude(force)
      const project = getProject(get(), projectPath)
      const selected = project._activeSessionId ? project._sessions[project._activeSessionId]?.apiProviderId ?? null : null
      if (selected === apiProviderId) get().setHarnessResources('claude', resources)
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
          force,
        })
        const fromResources = extractClaudeModels(bundle)
        if (fromResources.length > 0) return fromResources
        const models = (await window.environment.listRemoteModels(
          remote.connectionId,
          'claude',
          apiProviderId,
          force,
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
        force,
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
          force,
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

  setSelectedModel: (model, target) => {
    const state = get()
    const { projectPath: activeProject, sessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
    const provider = session.sessionProvider ?? session.preferredProvider

    if (isAcpProtocolHarness(provider) || provider === 'opencode' || provider === 'cursor') {
      const acpModeSwitch = isAcpProtocolHarness(provider) && session.selectedModel !== model
        ? resolveAcpModeForModelSwitch(session, model)
        : null
      const patch: Partial<import('../types').PerSessionState> = {
        selectedModel: model,
        modelUserChosen: true,
        contextWindow: null,
        ...(isAcpProtocolHarness(provider) && session.selectedModel !== model ? { selectedAcpContextWindow: null } : {}),
        ...(acpModeSwitch?.changed ? { selectedAcpModeId: acpModeSwitch.nextModeId } : {}),
        ...(provider === 'cursor'
          ? applyCursorModelSelection(state, session, model, activeProject, sessionId, target, set, get)
          : {}),
      }
      set((s) => commitPerSession(s, target, () => patch))
      pushSettings(activeProject, sessionId, session, {
        model,
        ...(provider === 'cursor' && patch.selectedEffort ? { effort: patch.selectedEffort } : {}),
        ...(acpModeSwitch?.changed && acpModeSwitch.nextModeId ? { mode: acpModeSwitch.nextModeId } : {}),
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
    set((s) => commitPerSession(s, target, () => ({
      selectedModel: model,
      selectedEffort: defaultEffort,
      modelUserChosen: true,
      effortUserChosen: false,
      contextWindow: null,
    })))
    pushSettings(activeProject, sessionId, session, { model, effort: defaultEffort ?? null })
    if (!isRemote && getScopedPerSession(get(), target).draftText.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setSelectedEffort: (effort, target) => {
    const state = get()
    const { projectPath: activeProject, sessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
    const provider = session.sessionProvider ?? session.preferredProvider
    const patch: Partial<import('../types').PerSessionState> = {
      selectedEffort: effort,
      effortUserChosen: true,
    }
    if (provider === 'cursor' && effort) {
      const nextParams = resolveCursorEffortParamPatch(state, session, effort)
      if (nextParams) patch.cursorModelParams = nextParams
    }
    set((s) => commitPerSession(s, target, () => patch))
    pushSettings(activeProject, sessionId, session, { effort: effort ?? null })
    if (!parseRemoteProjectKey(activeProject) && getScopedPerSession(get(), target).draftText.length > 0) {
      triggerPrewarm(get(), activeProject)
    }
  },

  setClaudeFastMode: (enabled, target) => {
    const { projectPath, sessionId, session } = resolveWriteScope(get(), target)
    if (!projectPath) return
    set(s => commitPerSession(s, target, () => ({ claudeFastMode: enabled })))
    pushSettings(projectPath, sessionId, session, { claudeFastMode: enabled })
  },

  setUltracode: (enabled, target) => {
    const { projectPath: activeProject, sessionId, session } = resolveWriteScope(get(), target)
    if (!activeProject) return
    set((s) => commitPerSession(s, target, () => ({ ultracode: enabled })))
    pushSettings(activeProject, sessionId, session, { ultracode: enabled })
  },

  setFastMode: (enabled) => {
    void window.app.setFastMode(enabled)
  },
})
