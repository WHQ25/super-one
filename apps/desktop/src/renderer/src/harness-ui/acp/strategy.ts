import { acpAgentIdForHarness, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import { isAcpEffortConfigId } from '@superone/shared/effort-labels'
import { acpEffortOptionsForModel, acpModeCatalog, clampAcpEffortForModel } from '@superone/shared/harness/acp-mode-catalog'
import { acpAgentDefaultsFor } from '@superone/shared/harness/session-defaults'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'
import { callSession } from '@/lib/session-client'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { acpHarnessForAgent, type AcpHarnessId } from '@/stores/chat-store/harness/acp-slots'
import { defaultPrefsCache, sessionDefaultsFor, toEffortLevel } from '@/stores/chat-store/helpers/prefs-cache'
import type { PerSessionState } from '@/stores/chat-store/types'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

function resolvedAcpMode(
  session: Pick<PerSessionState, 'acpModels' | 'acpModes' | 'acpModeConfigId' | 'selectedAcpModeId' | 'selectedModel'>,
): string | null {
  const hasCatalog = session.acpModels.length > 0 || session.acpModes.length > 0
  if (!hasCatalog || !isAcpEffortConfigId(session.acpModeConfigId)) {
    return session.selectedAcpModeId
  }
  return clampAcpEffortForModel(
    acpEffortOptionsForModel(
      session.acpModels,
      session.selectedModel,
      acpModeCatalog({
        modes: session.acpModes,
        modeConfigId: session.acpModeConfigId,
        selectedModeId: session.selectedAcpModeId,
      }).efforts,
    ),
    session.selectedAcpModeId,
  )
}

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
      const carryPrevious = harnessId === 'acp-grok'
        && !!previousAgent
        && acpHarnessForAgent(previousAgent) === harnessId
        && isGrokAcpAgent(previousAgent)
      const agentId = canonicalAgentId
      session.acpAgentId = agentId
      const catalog = getCachedAcpCatalog(state.harnessResources[harnessId], agentId)
      if (catalog) {
        const defaults = acpAgentDefaultsFor(defaultPrefsCache.agentPreference, harnessId)
        const preferSelected = carryPrevious && !(defaults.defaultModel && !previousSession?.modelUserChosen)
          ? (previousSession?.selectedModel ?? null)
          : null
        const preferModeId = carryPrevious && !(defaults.defaultEffort && !previousSession?.effortUserChosen)
          ? (previousSession?.selectedAcpModeId ?? null)
          : null
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
            preferModeId: session.selectedAcpModeId || (isAcpEffortConfigId(catalog.modeConfigId) ? (session.selectedEffort ?? null) : null),
            agentId: session.acpAgentId,
          })
        : {}
    },
    prewarmHint: (session) => {
      const effort = isAcpEffortConfigId(session.acpModeConfigId)
        ? toEffortLevel(resolvedAcpMode(session))
        : undefined
      return {
        model: session.selectedModel || undefined,
        ...(effort ? { effort } : {}),
        acpAgentId: session.acpAgentId ?? undefined,
      }
    },
    runModel: (session) => {
      const acpEffort = isAcpEffortConfigId(session.acpModeConfigId)
        ? toEffortLevel(resolvedAcpMode(session))
        : undefined
      return {
        model: session.selectedModel || undefined,
        effort: acpEffort ?? session.selectedEffort ?? undefined,
      }
    },
    draftSettings: (session) => {
      const mode = resolvedAcpMode(session)
      return {
        ...(mode ? { mode } : {}),
        ...(session.selectedAcpContextWindow ? { contextWindow: session.selectedAcpContextWindow } : {}),
      }
    },
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
