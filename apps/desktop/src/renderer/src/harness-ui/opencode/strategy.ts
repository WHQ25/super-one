import { reconcileOpenCodeSelection, resolveDefaultOpenCodeSelection } from '@/stores/chat-store/harness/opencode-handler'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const opencodeStrategy: HarnessStrategy = {
  selection: neutralSelection,
  seed: (session, { state }) => {
    const selection = resolveDefaultOpenCodeSelection(state.harnessResources.opencode?.models ?? [])
    session.selectedModel = selection.modelId
    session.selectedEffort = selection.effort
  },
  missingDefaults: () => ({}),
  /**
   * A restored pick outranks the catalog default, but only while the catalog
   * still offers it: applyOpenCodeResources does not re-run for an already-loaded
   * catalog, so a removed model would otherwise stick. Not probed yet (no
   * resources) keeps the pick; a loaded-but-empty catalog clears it.
   */
  restore: (session, { state }) => {
    const resources = state.harnessResources.opencode
    if (!resources) return {}
    const selection = reconcileOpenCodeSelection(resources.models, session.selectedModel, session.selectedEffort)
    return { selectedModel: selection.modelId, selectedEffort: selection.effort }
  },
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
  turnSettings: ({ session }) => ({
    desktop: session.openCodeAgentId ? { agent: session.openCodeAgentId } : {},
  }),
  draftSettings: (session) => ({ agent: session.openCodeAgentId }),
}
