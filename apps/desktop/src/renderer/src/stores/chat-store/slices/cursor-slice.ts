import type { StateCreator } from 'zustand'
import { shallow } from 'zustand/shallow'
import type { EffortLevel } from '@superone/shared/agent-types'
import {
  findCursorEffortParam,
  normalizeEffortValue,
} from '@superone/cursor/cursor-model-selection'
import type { ChatStore, PerSessionState, SessionWriteTarget } from '../types'
import {
  commitPerSession,
  getScopedPerSession,
  resolveWriteScope,
  updateProjectState,
} from '../index'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { pushSettings } from '@/lib/session-client'
import {
  ensureCursorHarnessModelPrefsLoaded,
  persistCursorHarnessModelParams,
  resolveCursorHarnessModelParams,
} from '../helpers/cursor-model-prefs'

export interface CursorSlice {
  setCursorModelParams: (params: Record<string, string>, target?: SessionWriteTarget) => void
  setCursorModelParam: (id: string, value: string, target?: SessionWriteTarget) => void
  refreshCursorSlashItems: (projectPath?: string) => Promise<void>
}

export function applyCursorModelSelection(
  state: ChatStore,
  session: PerSessionState,
  model: string,
  activeProject: string,
  sessionId: string | null,
  target: SessionWriteTarget | undefined,
  set: Parameters<StateCreator<ChatStore, [], [], CursorSlice>>[0],
  get: Parameters<StateCreator<ChatStore, [], [], CursorSlice>>[1],
): { cursorModelParams: Record<string, string>; selectedEffort?: EffortLevel; effortUserChosen: true } {
  const cursorModels = state.harnessResources.cursor?.models ?? []
  const cursorModel = cursorModels.find((m) => m.id === model)
  if (
    session.selectedModel
    && session.selectedModel !== model
    && Object.keys(session.cursorModelParams).length > 0
  ) {
    persistCursorHarnessModelParams(session.selectedModel, session.cursorModelParams)
  }
  const resolveParamsAndEffort = () => {
    const params = resolveCursorHarnessModelParams(model, cursorModel)
    const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
    const nextEffort = effortParam
      ? (normalizeEffortValue(params[effortParam.id] ?? '') ?? undefined)
      : undefined
    return { params, nextEffort }
  }
  const { params, nextEffort } = resolveParamsAndEffort()
  void ensureCursorHarnessModelPrefsLoaded().then(() => {
    const live = getScopedPerSession(get(), target)
    if ((live.sessionProvider ?? live.preferredProvider) !== 'cursor') return
    if (live.selectedModel !== model) return
    const resolved = resolveParamsAndEffort()
    set((s) => commitPerSession(s, target, () => ({
      cursorModelParams: resolved.params,
      selectedEffort: resolved.nextEffort,
      effortUserChosen: true,
    })))
    if (resolved.nextEffort) pushSettings(activeProject, sessionId, live, { effort: resolved.nextEffort })
  })
  return {
    cursorModelParams: params,
    selectedEffort: nextEffort,
    effortUserChosen: true,
  }
}

export function resolveCursorEffortParamPatch(
  state: ChatStore,
  session: PerSessionState,
  effort: EffortLevel,
): Record<string, string> | null {
  const cursorModel = state.harnessResources.cursor?.models.find((m) => m.id === session.selectedModel)
  const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
  if (!effortParam) return null
  const raw = effortParam.values.find((v) =>
    v.value === effort || normalizeEffortValue(v.value) === effort,
  )?.value
  if (!raw) return null
  const nextParams = { ...session.cursorModelParams, [effortParam.id]: raw }
  if (session.selectedModel) {
    persistCursorHarnessModelParams(session.selectedModel, nextParams)
  }
  return nextParams
}

export const createCursorSlice: StateCreator<ChatStore, [], [], CursorSlice> = (set, get) => ({
  setCursorModelParams: (params, target) => {
    const state = get()
    const { projectPath: activeProject, session } = resolveWriteScope(state, target)
    if (!activeProject) return
    if (shallow(session.cursorModelParams, params)) return
    set((s) => commitPerSession(s, target, () => ({ cursorModelParams: params })))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, params)
    }
  },

  setCursorModelParam: (id, value, target) => {
    const state = get()
    const { projectPath: activeProject, sessionId, session } = resolveWriteScope(state, target)
    if (!activeProject) return
    const nextParams = { ...session.cursorModelParams, [id]: value }
    const patch: Partial<PerSessionState> = { cursorModelParams: nextParams }
    const cursorModel = state.harnessResources.cursor?.models.find((m) => m.id === session.selectedModel)
    const effortParam = findCursorEffortParam(cursorModel?.parameters ?? [])
    if (effortParam && effortParam.id === id) {
      const nextEffort = normalizeEffortValue(value)
      if (nextEffort) {
        patch.selectedEffort = nextEffort
        patch.effortUserChosen = true
      }
    }
    set((s) => commitPerSession(s, target, () => patch))
    if (session.selectedModel) {
      persistCursorHarnessModelParams(session.selectedModel, nextParams)
    }
    if (patch.selectedEffort) pushSettings(activeProject, sessionId, session, { effort: patch.selectedEffort })
  },

  refreshCursorSlashItems: async (projectPath) => {
    const target = projectPath ?? get().activeProject
    if (!target || parseRemoteProjectKey(target)) return
    const current = get().projectSessions[target]
    if (current?._cursorSlashItemsLoading) return
    set((s) => updateProjectState(s, target, () => ({ _cursorSlashItemsLoading: true })))
    try {
      const items = await window.app.cursorListSlashItems(target)
      set((s) => updateProjectState(s, target, () => ({
        _cursorSlashItems: Array.isArray(items) ? items : [],
        _cursorSlashItemsLoading: false,
      })))
    } catch (error) {
      console.warn('[refreshCursorSlashItems] Failed:', error)
      set((s) => updateProjectState(s, target, () => ({ _cursorSlashItemsLoading: false })))
    }
  },
})
