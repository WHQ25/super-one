import { getDefaultEffortForModel } from '@/stores/chat-store/defaults'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

/** dsh's model control fills its own default once its catalog is known. */
export const dshStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'always',
  seed: () => {},
  missingDefaults: () => ({}),
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
  draftSettings: (session) => (session.dshPreset ? { agentPreset: session.dshPreset } : {}),
  resetFields: () => ({ selectedModel: '', modelUserChosen: false }),
  onSelect: ({ get, session, patch, isCurrent, prewarmAfterDispose }) => {
    void get().initializeHarness('dsh').then(async () => {
      if (!isCurrent()) return
      const current = session()
      const models = get().harnessResources.dsh?.models ?? []
      const model = models.find((item) => item.id === current.selectedModel) ?? models.find((item) => item.isDefault) ?? models[0]
      // Model and effort reconcile together: a pick carried over from another
      // harness can name a level this model never offers, and dropping it here
      // is what keeps the picker's label and the route in agreement.
      const levels = model?.supportedEffortLevels ?? []
      const effort = current.selectedEffort && levels.includes(current.selectedEffort)
        ? current.selectedEffort
        : getDefaultEffortForModel(model)
      if (model && (model.id !== current.selectedModel || effort !== current.selectedEffort)) {
        patch({ selectedModel: model.id, selectedEffort: effort })
      }
      await prewarmAfterDispose()
    })
  },
}
