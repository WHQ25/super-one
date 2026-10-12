import { applyDefaultModel } from '@/stores/chat-store/helpers/agent-defaults'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const claudeStrategy: HarnessStrategy = {
  selection: neutralSelection,
  seed: (session, { claudeModels }) => applyDefaultModel(session, claudeModels),
  missingDefaults: (session, _project, claudeModels) => {
    if (session.selectedModel) return {}
    const draft = { ...session }
    applyDefaultModel(draft, claudeModels)
    return { selectedModel: draft.selectedModel, selectedEffort: draft.selectedEffort }
  },
  prewarmHint: (session) => ({ model: session.selectedModel || undefined, effort: session.selectedEffort }),
}
