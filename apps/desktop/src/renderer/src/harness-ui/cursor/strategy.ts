import { CURSOR_DEFAULT_PERMISSION_MODE, CURSOR_PERMISSION_MODES } from '@/components/chat/cursorPermissionModes'
import { enabledCursorModels, resolveDefaultCursorSelection } from '@/stores/chat-store/harness/cursor-handler'
import { findCursorEffortParam, normalizeEffortValue } from '@superone/cursor/cursor-model-selection'
import { ensureCursorHarnessModelPrefsLoaded, resolveCursorHarnessModelParams } from '@/stores/chat-store/helpers/cursor-model-prefs'
import { getProject } from '@/stores/chat-store/helpers/store-helpers'
import { effortForLevels } from '../effort'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const cursorStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'never',
  sendStartsStreaming: true,
  slash: { hostCommands: ['clear', 'mcp'], expandsPromptBody: true },
  seed: (session, { state }) => {
    const selection = resolveDefaultCursorSelection(enabledCursorModels(state.harnessResources.cursor))
    session.selectedModel = selection.modelId
    session.selectedEffort = selection.effort
  },
  missingDefaults: () => ({}),
  prewarmHint: (session) => ({ model: session.selectedModel || undefined }),
  turnSettings: ({ session }) => ({ desktop: { modelParams: session.cursorModelParams ?? {} } }),
  resetFields: (state) => {
    const selection = resolveDefaultCursorSelection(enabledCursorModels(state.harnessResources.cursor))
    return { selectedModel: selection.modelId, selectedEffort: selection.effort, modelUserChosen: false, effortUserChosen: false }
  },
  onSelect: ({ get, projectPath, session, patch, isCurrent, prewarmAfterDispose }) => {
    void get().initializeHarness('cursor').then(async () => {
      if (!isCurrent()) return
      const current = session()
      const models = enabledCursorModels(get().harnessResources.cursor)
      const fallback = resolveDefaultCursorSelection(models)
      const model = models.find((item) => item.id === current.selectedModel) ?? models.find((item) => item.id === fallback.modelId)
      if (model) {
        await ensureCursorHarnessModelPrefsLoaded()
        const remembered = resolveCursorHarnessModelParams(model.id, model)
        const params = Object.keys(current.cursorModelParams).length > 0 && current.selectedModel === model.id
          ? current.cursorModelParams
          : remembered
        // Effort lives in the model's parameters; a remembered value wins over the carried pick.
        const effortParam = findCursorEffortParam(model.parameters ?? [])
        const fromParams = effortParam ? normalizeEffortValue(params[effortParam.id] ?? '') : null
        const levels = model.supportedEffortLevels ?? []
        const effort = fromParams && levels.includes(fromParams) ? fromParams : effortForLevels(levels, current.selectedEffort)
        const nextParams = effortParam && effort
          ? {
              ...params,
              [effortParam.id]: effortParam.values.find((v) => v.value === effort || normalizeEffortValue(v.value) === effort)?.value
                ?? params[effortParam.id],
            }
          : params
        if (model.id !== current.selectedModel || effort !== current.selectedEffort || Object.keys(current.cursorModelParams).length === 0) {
          patch({ selectedModel: model.id, selectedEffort: effort, cursorModelParams: nextParams })
        }
      }
      await prewarmAfterDispose()
    })
    if (!getProject(get(), projectPath)._cursorSlashItemsLoading) void get().refreshCursorSlashItems(projectPath)
  },
  /** Agent / Plan / Full Access. */
  permissionCycle: CURSOR_PERMISSION_MODES,
  /** Plan vs Agent; Full Access stays reachable through the selector and the cycle. */
  togglePlan: ({ store, session, target }) => {
    store.setPermissionMode(session.permissionMode === 'plan' ? CURSOR_DEFAULT_PERMISSION_MODE : 'plan', target)
  },
}
