import { findCursorEffortParam, normalizeEffortValue } from '@superone/cursor/cursor-model-selection'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { getDefaultEffortForModel } from '../defaults'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '../harness/acp-handler'
import { enabledCursorModels, resolveDefaultCursorSelection } from '../harness/cursor-handler'
import { resolveDefaultOpenCodeSelection } from '../harness/opencode-handler'
import type { ChatProvider, ChatStore } from '../types'
import { resolveDefaultClaudeEffort, resolveDefaultClaudeModel } from './agent-defaults'
import { buildSlashCommands } from './chat-helpers'
import { resolveSessionCodexSelection } from './codex-helpers'
import { ensureCursorHarnessModelPrefsLoaded, resolveCursorHarnessModelParams } from './cursor-model-prefs'
import type { ChatStoreSet } from './lifecycle'
import { sessionDefaultsFor } from './prefs-cache'
import { resolveProvider } from './provider-routing'
import { getActivePerSession, getProject, triggerPrewarm, updateActivePerSession, updatePerSession, updateProjectState } from './store-helpers'

export function setPreferredProviderImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  provider: ChatProvider,
  opts?: { userChosen?: boolean },
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get())
  if (!opts?.userChosen && session.hostSessionOwned) return
  if (session.sessionProvider && session.messages.length > 0) return
  if (session.sessionProvider === provider || (provider === 'claude' && !session.sessionProvider && session.preferredProvider === 'claude')) {
    return
  }
  // Empty drafts keep the same SuperOne session id across harness switches.
  // Main-process runtime for a prior harness is disposed eagerly below so stale
  // events cannot land on the shared sid before the next prewarm/send.

  // ACP model ids (e.g. grok-4.6 / opencode/…) must not stick on Claude/Codex selectors.
  const acpModeReset = {
    acpModes: [] as import('@superone/shared/agent-types').ModelOption[],
    acpModeConfigId: null as string | null,
    selectedAcpModeId: null as string | null,
    acpModesStatus: 'idle' as const,
    acpSlashCommands: [] as import('@superone/shared/agent-types').SlashCommandInfo[],
    acpSlashCommandsStatus: 'idle' as const,
    // A goal belongs to the harness that set it; carrying one across a switch
    // would leave the indicator pointing at a thread the new harness never saw.
    sessionGoal: null,
  }
  /** Shared resets when leaving any harness on an empty draft. */
  const emptyDraftHarnessReset = {
    // Usage belongs to the disposed harness runtime, even before the first send.
    contextTokens: 0,
    contextWindow: null,
    detailedUsage: null,
    streamingTokens: { input: 0, output: 0 },
    totalCostUsd: 0,
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    _providerSessionId: null as string | null,
    status: 'idle' as const,
    awaitingAssistantReply: false,
    slashCommandOutput: null,
  }
  const modelReset = (() => {
    if (provider === 'claude') {
      const isRemote = !!parseRemoteProjectKey(activeProject)
      const claudeModels = isRemote
        ? (getProject(get(), activeProject).claudeModels ?? [])
        : (get().harnessResources.claude?.models ?? [])
      const defaultModel = resolveDefaultClaudeModel(claudeModels)
      return {
        selectedModel: defaultModel?.id ?? '',
        selectedEffort: resolveDefaultClaudeEffort(defaultModel),
        modelUserChosen: false,
        effortUserChosen: false,
        acpModels: [] as import('@superone/shared/agent-types').ModelOption[],
        acpModelConfigId: null as string | null,
        acpModelsStatus: 'idle' as const,
        acpModelsError: null as string | null,
        ...acpModeReset,
      }
    }
    if (provider === 'codex') {
      return {
        selectedModel: '',
        modelUserChosen: false,
        effortUserChosen: false,
        acpModels: [] as import('@superone/shared/agent-types').ModelOption[],
        acpModelConfigId: null as string | null,
        acpModelsStatus: 'idle' as const,
        acpModelsError: null as string | null,
        ...acpModeReset,
      }
    }
    if (provider === 'opencode') {
      const selection = resolveDefaultOpenCodeSelection(get().harnessResources.opencode?.models ?? [])
      return {
        selectedModel: selection.modelId,
        selectedEffort: selection.effort,
        modelUserChosen: false,
        effortUserChosen: false,
        acpModels: [] as import('@superone/shared/agent-types').ModelOption[],
        acpModelConfigId: null as string | null,
        acpModelsStatus: 'idle' as const,
        acpModelsError: null as string | null,
        ...acpModeReset,
      }
    }
    if (provider === 'cursor') {
      const selection = resolveDefaultCursorSelection(enabledCursorModels(get().harnessResources.cursor))
      return {
        selectedModel: selection.modelId,
        selectedEffort: selection.effort,
        modelUserChosen: false,
        effortUserChosen: false,
        acpModels: [] as import('@superone/shared/agent-types').ModelOption[],
        acpModelConfigId: null as string | null,
        acpModelsStatus: 'idle' as const,
        acpModelsError: null as string | null,
        ...acpModeReset,
      }
    }
    return {
      acpModels: [] as import('@superone/shared/agent-types').ModelOption[],
      acpModelConfigId: null as string | null,
      acpModelsStatus: 'loading' as const,
      acpModelsError: null as string | null,
      selectedModel: '',
      modelUserChosen: false,
      ...acpModeReset,
      acpModesStatus: 'idle' as const,
    }
  })()

  const draftSid = getProject(get(), activeProject)._activeSessionId

  const switchedPermissionMode = sessionDefaultsFor(provider).permissionMode
  set((s) => updateActivePerSession(s, () => ({
    ...modelReset,
    ...emptyDraftHarnessReset,
    preferredProvider: provider,
    sessionProvider: provider,
    harnessUserChosen: opts?.userChosen === true,
    ...(switchedPermissionMode ? { permissionMode: switchedPermissionMode } : {}),
  })))

  // Drop any in-memory main session for this sid (wrong harness / prewarmed prior).
  // Awaited before ACP/OpenCode prewarm so recreate cannot race the dispose.
  // resetSession without newSessionId only disposes.
  const disposePriorMain: Promise<unknown> =
    draftSid && typeof window.agent?.resetSession === 'function'
      ? window.agent.resetSession(draftSid).catch(() => null)
      : Promise.resolve(null)

  if (provider === 'codex') {
    const project = getProject(get(), activeProject)
    const sess = getActivePerSession(get())
    const selected = resolveSessionCodexSelection(
      project.codexModels,
      sess.selectedCodexModel,
      sess.selectedCodexReasoningEffort,
    )
    if (
      selected.modelId !== sess.selectedCodexModel
      || selected.reasoningEffort !== sess.selectedCodexReasoningEffort
    ) {
      set((s) => updateActivePerSession(s, () => ({
        selectedCodexModel: selected.modelId,
        selectedCodexReasoningEffort: selected.reasoningEffort,
      })))
    }
    if (project._codexSkills.length === 0 && !project._codexSkillsLoading) {
      void get().refreshCodexSkills(activeProject)
    }
    void disposePriorMain
  }
  if (provider === 'acp') {
    // Prefer agent id already set by setAcpAgentId (UI selects agent before harness).
    const existingAgentId = getActivePerSession(get()).acpAgentId
    if (existingAgentId) {
      const catalog = getCachedAcpCatalog(get().harnessResources.acp, existingAgentId)
      if (catalog) {
        set((s) => updateActivePerSession(s, () => sessionPatchFromAcpCatalog(catalog)))
      }
      void disposePriorMain.then(() => {
        triggerPrewarm(get())
      })
    } else {
      void (async () => {
        try {
          const settings = await window.app.getAppSettings()
          const agentId = settings.agentPreference.acp?.selectedAgentId
            ?? get().harnessResources.acp?.selectedAgentId
            ?? 'grok-build'
          if (!getActivePerSession(get()).acpAgentId) {
            set((s) => updateActivePerSession(s, () => ({ acpAgentId: agentId })))
          }
        } catch {
          if (!getActivePerSession(get()).acpAgentId) {
            set((s) => updateActivePerSession(s, () => ({ acpAgentId: 'grok-build' })))
          }
        }
        const agentId = getActivePerSession(get()).acpAgentId
        const catalog = getCachedAcpCatalog(get().harnessResources.acp, agentId)
        if (catalog) {
          set((s) => updateActivePerSession(s, () => sessionPatchFromAcpCatalog(catalog)))
        }
        await disposePriorMain
        triggerPrewarm(get())
      })()
    }
  }
  if (provider === 'opencode') {
    void get().initializeHarness('opencode').then(async () => {
      const session = getActivePerSession(get())
      // User may have switched harness before OpenCode resources finished loading.
      if ((session.sessionProvider ?? session.preferredProvider) !== 'opencode') return
      const models = get().harnessResources.opencode?.models ?? []
      const selected = models.find((model) => model.id === session.selectedModel)
      const fallback = resolveDefaultOpenCodeSelection(models)
      const model = selected ?? models.find((item) => item.id === fallback.modelId)
      const levels = model?.supportedEffortLevels ?? []
      const effort = session.selectedEffort && levels.includes(session.selectedEffort)
        ? session.selectedEffort
        : levels.includes('medium') ? 'medium' : levels[0]
      if (model && (model.id !== session.selectedModel || effort !== session.selectedEffort)) {
        set((state) => updateActivePerSession(state, () => ({ selectedModel: model.id, selectedEffort: effort })))
      }
      await disposePriorMain
      triggerPrewarm(get())
    })
  }
  if (provider === 'cursor') {
    void get().initializeHarness('cursor').then(async () => {
      const session = getActivePerSession(get())
      if ((session.sessionProvider ?? session.preferredProvider) !== 'cursor') return
      const models = enabledCursorModels(get().harnessResources.cursor)
      const selected = models.find((model) => model.id === session.selectedModel)
      const fallback = resolveDefaultCursorSelection(models)
      const model = selected ?? models.find((item) => item.id === fallback.modelId)
      if (!model) {
        await disposePriorMain
        triggerPrewarm(get())
        return
      }
      const remembered = await (async () => {
        await ensureCursorHarnessModelPrefsLoaded()
        return resolveCursorHarnessModelParams(model.id, model)
      })()
      const params = Object.keys(session.cursorModelParams).length > 0
        && session.selectedModel === model.id
        ? session.cursorModelParams
        : remembered
      const effortParam = findCursorEffortParam(model.parameters ?? [])
      const fromParams = effortParam
        ? normalizeEffortValue(params[effortParam.id] ?? '')
        : null
      const levels = model.supportedEffortLevels ?? []
      const effort = (fromParams && levels.includes(fromParams))
        ? fromParams
        : (session.selectedEffort && levels.includes(session.selectedEffort)
          ? session.selectedEffort
          : levels.includes('medium') ? 'medium' : levels[0])
      const nextParams = effortParam && effort
        ? {
            ...params,
            [effortParam.id]: effortParam.values.find((v) =>
              v.value === effort || normalizeEffortValue(v.value) === effort,
            )?.value ?? params[effortParam.id],
          }
        : params
      if (
        model.id !== session.selectedModel
        || effort !== session.selectedEffort
        || Object.keys(session.cursorModelParams).length === 0
      ) {
        set((state) => updateActivePerSession(state, () => ({
          selectedModel: model.id,
          selectedEffort: effort,
          cursorModelParams: nextParams,
        })))
      }
      await disposePriorMain
      triggerPrewarm(get())
    })
    const project = getProject(get(), activeProject)
    if (!project._cursorSlashItemsLoading) {
      void get().refreshCursorSlashItems(activeProject)
    }
  }
  if (provider === 'dsh') {
    void get().initializeHarness('dsh').then(async () => {
      const session = getActivePerSession(get())
      // User may have switched harness before DeepSeek resources finished loading.
      if ((session.sessionProvider ?? session.preferredProvider) !== 'dsh') return
      const models = get().harnessResources.dsh?.models ?? []
      const selected = models.find((model) => model.id === session.selectedModel)
      const fallback = selected ?? models.find((model) => model.isDefault) ?? models[0]
      // Model and effort reconcile together: a pick carried over from another
      // harness can name a level this model never offers, and dropping it here
      // is what keeps the picker's label and the route in agreement.
      const levels = fallback?.supportedEffortLevels ?? []
      const effort = session.selectedEffort && levels.includes(session.selectedEffort)
        ? session.selectedEffort
        : getDefaultEffortForModel(fallback)
      if (fallback && (fallback.id !== session.selectedModel || effort !== session.selectedEffort)) {
        set((state) => updateActivePerSession(state, () => ({
          selectedModel: fallback.id,
          selectedEffort: effort,
        })))
      }
      await disposePriorMain
      triggerPrewarm(get())
    })
  }
  if (provider === 'claude') {
    void disposePriorMain
    const isRemote = !!parseRemoteProjectKey(activeProject)
    if (!isRemote) {
      set((s) => {
        const claude = s.harnessResources.claude
        if (!claude) return {}
        const proj = getProject(s, activeProject)
        return updateProjectState(s, activeProject, () => ({
          slashCommands: buildSlashCommands(
            claude.slashCommands,
            claude.skills,
            claude.commands,
            proj._projectSkills,
            proj._projectCommands,
            new Set(s.disabledSkills),
          ),
        }))
      })
    }
    const afterModels = () => {
      const sess = getActivePerSession(get())
      if ((sess.sessionProvider ?? sess.preferredProvider) !== 'claude') return
      const claudeModels = isRemote
        ? (getProject(get(), activeProject).claudeModels ?? [])
        : (get().harnessResources.claude?.models ?? [])
      if (claudeModels.length === 0) return
      const known = claudeModels.some((m) => m.id === sess.selectedModel)
      if (known && sess.selectedModel) return
      const defaultModel = resolveDefaultClaudeModel(claudeModels)
      if (!defaultModel) return
      set((s) => updateActivePerSession(s, () => ({
        selectedModel: defaultModel.id,
        selectedEffort: resolveDefaultClaudeEffort(defaultModel),
        modelUserChosen: false,
        effortUserChosen: false,
      })))
    }
    if (isRemote) {
      void get().refreshClaudeResources(false).then(afterModels)
    } else {
      void get().initializeHarness('claude').then(afterModels)
    }
  } else {
    // Codex dispose already started above; ACP/OpenCode chain dispose→prewarm.
    void get().initializeHarness(provider)
  }
}

/**
 * Fill ACP model/mode catalog when a session is opened without live acp_models
 * events (mini-window cold path, or Case A after live sync that only carried ids).
 * Prefers disk/startup cache; falls back to initializeHarness + refresh.
 */
export function hydrateAcpCatalogForSession(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  sessionId: string,
): void {
  const session = get().projectSessions[projectPath]?._sessions[sessionId]
  if (!session) return
  if (resolveProvider(session) !== 'acp' || !session.acpAgentId) return
  // Live replay already populated a ready catalog — don't clobber.
  if (session.acpModels.length > 0 && session.acpModelsStatus === 'ready') return

  const agentId = session.acpAgentId
  const preferSelected = session.selectedModel || null

  const applyCatalog = (): void => {
    const current = get().projectSessions[projectPath]?._sessions[sessionId]
    if (!current || resolveProvider(current) !== 'acp') return
    if (current.acpAgentId !== agentId) return
    if (current.acpModels.length > 0 && current.acpModelsStatus === 'ready') return
    const catalog = getCachedAcpCatalog(get().harnessResources.acp, agentId)
    if (!catalog) return
    set((s) => updatePerSession(s, projectPath, sessionId, () =>
      sessionPatchFromAcpCatalog(catalog, {
        preferSelected: current.selectedModel || preferSelected,
      }),
    ))
  }

  const cached = getCachedAcpCatalog(get().harnessResources.acp, agentId)
  if (cached) {
    applyCatalog()
    return
  }

  void get().initializeHarness('acp').then(() => {
    applyCatalog()
    if (get().projectSessions[projectPath]?._sessions[sessionId]?.acpModels.length) return
    void window.app.refreshAcpModels?.(agentId).then((fresh) => {
      if (!fresh) return
      get().setHarnessResources('acp', fresh)
      applyCatalog()
    }).catch((err) => {
      console.warn('[acp] hydrate catalog refresh failed:', err)
    })
  })
}

export function setAcpAgentIdImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  agentId: string | null,
): void {
  const session = getActivePerSession(get())
  if (session.sessionProvider && session.messages.length > 0 && session.sessionProvider !== 'acp') return
  if (session.acpAgentId === agentId) {
    const acp = get().harnessResources.acp
    if (acp?.selectedAgentId === agentId) return
  }
  const catalog = getCachedAcpCatalog(get().harnessResources.acp, agentId)
  set((s) => updateActivePerSession(s, () => ({
    acpAgentId: agentId,
    acpModes: [],
    acpModeConfigId: null,
    selectedAcpModeId: null,
    acpModesStatus: 'idle' as const,
    acpSlashCommands: [],
    acpSlashCommandsStatus: 'idle' as const,
    sessionGoal: null,
    ...(catalog
      ? sessionPatchFromAcpCatalog(catalog)
      : {
          acpModels: [],
          acpModelConfigId: null,
          acpModelsStatus: 'loading' as const,
          acpModelsError: null,
          selectedModel: '',
          modelUserChosen: false,
        }),
  })))
  const acp = get().harnessResources.acp
  if (acp && acp.selectedAgentId !== agentId) {
    get().setHarnessResources('acp', { ...acp, selectedAgentId: agentId })
  }
  void (async () => {
    try {
      await window.app.saveAppSettings({
        agentPreference: {
          acp: { selectedAgentId: agentId },
        },
      })
    } catch (err) {
      console.error('[acp] persist selectedAgentId failed:', err)
    }
    // If cache miss, request a once-per-launch probe for this agent then hydrate.
    // Slash commands are not part of startup probe — loaded when / popup opens.
    if (!catalog && agentId) {
      try {
        const fresh = await window.app.refreshAcpModels?.(agentId)
        if (fresh) {
          get().setHarnessResources('acp', fresh)
          const nextCatalog = getCachedAcpCatalog(fresh, agentId)
          if (nextCatalog) {
            set((s) => updateActivePerSession(s, () => sessionPatchFromAcpCatalog(nextCatalog)))
          }
        }
      } catch (err) {
        console.warn('[acp] refresh models for agent failed:', err)
      }
    }
    triggerPrewarm(get())
  })()
}

const ACP_SLASH_LOAD_TIMEOUT_MS = 10_000
const _acpSlashLoadTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Lazy-load ACP slash commands when the user opens the / popup.
 * - Shows cached commands immediately when present
 * - Starts/ensures the agent runtime so available_commands_update can refresh the cache
 * - Sets loading status until the agent advertises commands (or timeout)
 */
export function ensureAcpSlashCommandsImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get())
  if (resolveProvider(session) !== 'acp') return
  if (!session.acpAgentId) return
  if (session.acpSlashCommandsStatus === 'loading') return

  const key = `${activeProject}:${session.acpAgentId}`

  // Always show loading while ensuring runtime so popup can display a spinner
  // (cached commands still render underneath). Live available_commands_update
  // writes ready + refreshed list into the cache.
  set((s) => updateActivePerSession(s, () => ({
    acpSlashCommandsStatus: 'loading',
  })))

  triggerPrewarm(get())

  const prevTimer = _acpSlashLoadTimeouts.get(key)
  if (prevTimer) clearTimeout(prevTimer)
  const timer = setTimeout(() => {
    _acpSlashLoadTimeouts.delete(key)
    const current = getActivePerSession(get())
    if (resolveProvider(current) !== 'acp') return
    if (current.acpAgentId !== session.acpAgentId) return
    if (current.acpSlashCommandsStatus !== 'loading') return
    set((s) => updateActivePerSession(s, () => ({ acpSlashCommandsStatus: 'ready' })))
  }, ACP_SLASH_LOAD_TIMEOUT_MS)
  _acpSlashLoadTimeouts.set(key, timer)
}
