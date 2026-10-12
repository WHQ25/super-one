import { enabledCursorModels, resolveDefaultCursorSelection } from '@/stores/chat-store/harness/cursor-handler'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const cursorStrategy: HarnessStrategy = {
  selection: neutralSelection,
  seed: (session, { state }) => {
    const selection = resolveDefaultCursorSelection(enabledCursorModels(state.harnessResources.cursor))
    session.selectedModel = selection.modelId
    session.selectedEffort = selection.effort
  },
  missingDefaults: () => ({}),
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
  turnSettings: ({ session }) => ({ desktop: { modelParams: session.cursorModelParams ?? {} } }),
}
