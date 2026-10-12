import { CURSOR_DEFAULT_PERMISSION_MODE, CURSOR_PERMISSION_MODES } from '@/components/chat/cursorPermissionModes'
import { enabledCursorModels, resolveDefaultCursorSelection } from '@/stores/chat-store/harness/cursor-handler'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const cursorStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'never',
  sendStartsStreaming: true,
  seed: (session, { state }) => {
    const selection = resolveDefaultCursorSelection(enabledCursorModels(state.harnessResources.cursor))
    session.selectedModel = selection.modelId
    session.selectedEffort = selection.effort
  },
  missingDefaults: () => ({}),
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
  turnSettings: ({ session }) => ({ desktop: { modelParams: session.cursorModelParams ?? {} } }),
  /** Agent / Plan / Full Access. */
  permissionCycle: CURSOR_PERMISSION_MODES,
  /** Plan vs Agent; Full Access stays reachable through the selector and the cycle. */
  togglePlan: ({ store, session, target }) => {
    store.setPermissionMode(session.permissionMode === 'plan' ? CURSOR_DEFAULT_PERMISSION_MODE : 'plan', target)
  },
}
