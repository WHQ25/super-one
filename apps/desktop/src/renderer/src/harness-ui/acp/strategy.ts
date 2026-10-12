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
}
