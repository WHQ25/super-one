import { reconcileOpenCodeSelection, resolveDefaultOpenCodeSelection } from '@/stores/chat-store/harness/opencode-handler'
import { openCodeAgentsFor } from '@/stores/chat-store/opencode-selectors'
import { neutralSelection } from '../neutral-selection'
import { effortForLevels } from '../effort'
import type { HarnessStrategy } from '../strategy'

export const opencodeStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'always',
  slash: { hostCommands: [] },
  inPlanMode: (session) => session.openCodeAgentId === 'plan',
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
  resetFields: (state) => {
    const selection = resolveDefaultOpenCodeSelection(state.harnessResources.opencode?.models ?? [])
    return { selectedModel: selection.modelId, selectedEffort: selection.effort, modelUserChosen: false, effortUserChosen: false }
  },
  onSelect: ({ get, session, patch, isCurrent, prewarmAfterDispose }) => {
    void get().initializeHarness('opencode').then(async () => {
      if (!isCurrent()) return
      const current = session()
      const models = get().harnessResources.opencode?.models ?? []
      const fallback = resolveDefaultOpenCodeSelection(models)
      const model = models.find((item) => item.id === current.selectedModel) ?? models.find((item) => item.id === fallback.modelId)
      const effort = effortForLevels(model?.supportedEffortLevels, current.selectedEffort)
      if (model && (model.id !== current.selectedModel || effort !== current.selectedEffort)) {
        patch({ selectedModel: model.id, selectedEffort: effort })
      }
      await prewarmAfterDispose()
    })
  },
  /** OpenCode has no permission modes; the shortcut steps through its primary agents. */
  cyclePermission: ({ store, session, target }) => {
    const agents = openCodeAgentsFor(store, session)
    if (agents.length === 0) return
    const index = agents.findIndex((agent) => agent.id === session.openCodeAgentId)
    store.setOpenCodeAgentId(agents[(index + 1) % agents.length]!.id, target)
  },
  togglePlan: ({ store, session, target }) => {
    const agents = openCodeAgentsFor(store, session)
    if (session.openCodeAgentId !== 'plan') {
      if (agents.some((agent) => agent.id === 'plan')) store.setOpenCodeAgentId('plan', target)
      return
    }
    // The runtime keeps its last agent, so leaving Plan must name one: the agent
    // used before Plan, else OpenCode's built-in default.
    const next = [session.openCodeAgentBeforePlan, 'build']
      .find((id) => agents.some((agent) => agent.id === id))
      ?? agents.find((agent) => agent.id !== 'plan')?.id
    if (next) store.setOpenCodeAgentId(next, target)
  },
}
