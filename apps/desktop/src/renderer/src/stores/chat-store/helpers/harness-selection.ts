import type { ModelOption, SlashCommandInfo } from '@superone/shared/agent-types'
import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import { resetHostSession } from '@/lib/session-client'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '../harness/acp-handler'
import type { ChatProvider, ChatStore } from '../types'
import type { ChatStoreSet } from './lifecycle'
import { sessionDefaultsFor } from './prefs-cache'
import { resolveProvider } from './provider-routing'
import { getActivePerSession, getProject, triggerPrewarm, updateActivePerSession, updatePerSession } from './store-helpers'

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
  if (resolveProvider(session) === provider) return
  // Empty drafts keep the same SuperOne session id across harness switches.
  // Main-process runtime for a prior harness is disposed eagerly below so stale
  // events cannot land on the shared sid before the next prewarm/send.

  const acpModeReset = {
    acpModes: [] as ModelOption[],
    acpModeConfigId: null as string | null,
    selectedAcpModeId: null as string | null,
    acpModesStatus: 'idle' as const,
    acpSlashCommands: [] as SlashCommandInfo[],
    acpSlashCommandsStatus: 'idle' as const,
    // A goal belongs to the harness that set it; carrying one across a switch
    // would leave the indicator pointing at a thread the new harness never saw.
    sessionGoal: null,
  }
  /** Shared resets when leaving any harness on an empty draft. */
  const emptyDraftHarnessReset = {
    // Provider/account bindings belong to the old harness; the new one uses its defaults.
    apiProviderId: null,
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
  const strategy = HARNESS_STRATEGIES[provider]
  // ACP model ids (e.g. grok-4.6 / opencode/…) must not stick on another harness's selectors.
  const modelReset = {
    acpModels: [] as ModelOption[],
    acpModelConfigId: null as string | null,
    acpModelsStatus: 'idle' as const,
    acpModelsError: null as string | null,
    ...acpModeReset,
    ...strategy.resetFields(get(), activeProject),
  }

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
    draftSid
      ? resetHostSession(activeProject, draftSid).catch(() => null)
      : Promise.resolve(null)

  strategy.onSelect({
    set,
    get,
    projectPath: activeProject,
    session: () => getActivePerSession(get()),
    patch: (update) => set((s) => updateActivePerSession(s, () => update)),
    isCurrent: () => resolveProvider(getActivePerSession(get())) === provider,
    prewarmAfterDispose: async () => {
      await disposePriorMain
      triggerPrewarm(get())
    },
  })
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
