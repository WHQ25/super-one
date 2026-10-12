import { ACP_PERMISSION_MODES } from '@/components/chat/acpPermissionModes'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const acpStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'always',
  /** Seed from the agent catalog cache, keeping the replaced session's agent, model and mode while still offered. */
  seed: (session, { state, previousSession }) => {
    const agentId = previousSession?.acpAgentId ?? state.harnessResources.acp?.selectedAgentId ?? 'grok-build'
    session.acpAgentId = agentId
    const catalog = getCachedAcpCatalog(state.harnessResources.acp, agentId)
    if (catalog) {
      Object.assign(session, sessionPatchFromAcpCatalog(catalog, { preferSelected: previousSession?.selectedModel ?? null }))
      // Prefer previous effort when still in the catalog (Grok modeConfigId is null).
      const prevMode = previousSession?.selectedAcpModeId
      if (prevMode && catalog.modes.some((m) => m.id === prevMode)) session.selectedAcpModeId = prevMode
    } else {
      session.acpModels = []
      session.acpModelConfigId = null
      session.acpModelsStatus = 'loading'
      session.acpModelsError = null
      session.selectedModel = ''
      session.modelUserChosen = false
    }
  },
  missingDefaults: () => ({}),
  restore: (session, { state }) => {
    const catalog = session.acpAgentId ? getCachedAcpCatalog(state.harnessResources.acp, session.acpAgentId) : null
    return catalog ? sessionPatchFromAcpCatalog(catalog) : {}
  },
  prewarmHint: (session) => ({ model: session.selectedModel || undefined, acpAgentId: session.acpAgentId ?? undefined }),
  draftSettings: (session) => ({
    ...(session.selectedAcpModeId ? { mode: session.selectedAcpModeId } : {}),
    ...(session.selectedAcpContextWindow ? { contextWindow: session.selectedAcpContextWindow } : {}),
  }),
  createSelections: (session) => (session.acpAgentId ? { acpAgentId: session.acpAgentId } : {}),
  /** The agent's catalog loads after the switch. */
  resetFields: () => ({ selectedModel: '', modelUserChosen: false, acpModelsStatus: 'loading' }),
  onSelect: ({ get, session, patch, prewarmAfterDispose }) => {
    void get().initializeHarness('acp')
    const applyCachedCatalog = () => {
      const catalog = getCachedAcpCatalog(get().harnessResources.acp, session().acpAgentId)
      if (catalog) patch(sessionPatchFromAcpCatalog(catalog))
    }
    // The UI may have picked the agent before the harness.
    if (session().acpAgentId) {
      applyCachedCatalog()
      void prewarmAfterDispose()
      return
    }
    void (async () => {
      const agentId = await window.app.getAppSettings()
        .then((settings) => settings.agentPreference.acp?.selectedAgentId ?? get().harnessResources.acp?.selectedAgentId)
        .catch(() => null)
      if (!session().acpAgentId) patch({ acpAgentId: agentId ?? 'grok-build' })
      applyCachedCatalog()
      await prewarmAfterDispose()
    })()
  },
  /** Only modes SuperOne can drive over the wire (see acpPermissionModes). */
  permissionCycle: ACP_PERMISSION_MODES,
  /** Plan is `session/set_mode`: toggle plan vs default rather than cycling. */
  togglePlan: ({ store, session, target }) => {
    store.setPermissionMode(session.permissionMode === 'plan' ? 'default' : 'plan', target)
  },
}
