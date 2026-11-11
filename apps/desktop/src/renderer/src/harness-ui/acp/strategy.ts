import { acpAgentIdForHarness, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { acpAgentDefaultsFor } from '@superone/shared/harness/session-defaults'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { callSession } from '@/lib/session-client'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { acpHarnessForAgent, type AcpHarnessId } from '@/stores/chat-store/harness/acp-slots'
import { defaultPrefsCache, sessionDefaultsFor } from '@/stores/chat-store/helpers/prefs-cache'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

const acpSlash: HarnessStrategy['slash'] = {
  hostCommands: ['clear', 'workflows', 'mcp'],
  /** Grok `/recap` is `x.ai/recap` (auto=false), not a prompt turn. */
  run: async (name, { session, projectPath, sessionId, patch }) => {
    if (name !== 'recap' || !isGrokAcpAgent(session.acpAgentId)) return false
    patch({ _pendingSlashCommand: '', isRecapping: true })
    const ok = sessionId
      ? await callSession(projectPath, sessionId, 'session.recap', { auto: false }).then((r) => r.ok, () => false)
      : false
    if (!ok) patch({ isRecapping: false })
    return true
  },
}

function createAcpStrategy(harnessId: AcpHarnessId): HarnessStrategy {
  const canonicalAgentId = acpAgentIdForHarness(harnessId)
  return {
    selection: neutralSelection,
    queuePolicy: 'always',
    slash: acpSlash,
    seed: (session, { state, previousSession }) => {
      const previousAgent = previousSession?.acpAgentId
      const carryPrevious = !!previousAgent
        && acpHarnessForAgent(previousAgent) === harnessId
        && (isGrokAcpAgent(previousAgent) || isAntigravityAcpAgent(previousAgent))
      const agentId = canonicalAgentId
      session.acpAgentId = agentId
      const catalog = getCachedAcpCatalog(state.harnessResources[harnessId], agentId)
      if (catalog) {
        const defaults = acpAgentDefaultsFor(defaultPrefsCache.agentPreference, harnessId)
        const preferSelected = defaults.defaultModel && !previousSession?.modelUserChosen
          ? null
          : (carryPrevious ? (previousSession?.selectedModel ?? null) : null)
        const preferModeId = defaults.defaultEffort && !previousSession?.effortUserChosen
          ? null
          : (carryPrevious ? (previousSession?.selectedAcpModeId ?? null) : null)
        Object.assign(session, sessionPatchFromAcpCatalog(catalog, {
          preferSelected,
          preferModeId,
          agentId,
        }))
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
      const catalog = session.acpAgentId ? getCachedAcpCatalog(state.harnessResources[harnessId], session.acpAgentId) : null
      return catalog
        ? sessionPatchFromAcpCatalog(catalog, {
            preferSelected: session.selectedModel || null,
            preferModeId: session.selectedAcpModeId || null,
            agentId: session.acpAgentId,
          })
        : {}
    },
    prewarmHint: (session) => ({ model: session.selectedModel || undefined, acpAgentId: session.acpAgentId ?? undefined }),
    draftSettings: (session) => ({
      ...(session.selectedAcpModeId ? { mode: session.selectedAcpModeId } : {}),
      ...(session.selectedAcpContextWindow ? { contextWindow: session.selectedAcpContextWindow } : {}),
    }),
    createSelections: (session) => (session.acpAgentId ? { acpAgentId: session.acpAgentId } : {}),
    resetFields: () => ({
      selectedModel: '',
      modelUserChosen: false,
      selectedEffort: undefined,
      effortUserChosen: false,
      acpModelsStatus: 'loading',
    }),
    onSelect: ({ get, session, patch, prewarmAfterDispose }) => {
      void get().initializeHarness(harnessId)
      const applyCachedCatalog = () => {
        const currentAgentId = session().acpAgentId ?? canonicalAgentId
        const catalog = getCachedAcpCatalog(get().harnessResources[harnessId], currentAgentId)
        if (catalog) patch(sessionPatchFromAcpCatalog(catalog, { agentId: currentAgentId }))
      }
      if (session().acpAgentId) {
        applyCachedCatalog()
        void prewarmAfterDispose()
        return
      }
      const permissionMode = sessionDefaultsFor(harnessId).permissionMode
      patch({
        acpAgentId: canonicalAgentId,
        ...(session().messages.length === 0 && permissionMode ? { permissionMode } : {}),
      })
      applyCachedCatalog()
      void prewarmAfterDispose()
    },
    permissionCycle: HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes,
    cyclePermission: ({ store, session, target }) => {
      const modes = HARNESS_LAUNCH_OPTIONS[harnessId].permissionModes
      const idx = modes.indexOf(session.permissionMode)
      const next = modes[((idx === -1 ? 0 : idx) + 1) % modes.length]!
      store.setPermissionMode(next, target)
    },
    togglePlan: ({ store, session, target }) => {
      store.setPermissionMode(session.permissionMode === 'plan' ? 'default' : 'plan', target)
    },
  }
}

export const acpGrokStrategy = createAcpStrategy('acp-grok')
export const acpAntigravityStrategy = createAcpStrategy('acp-antigravity')
