import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
import type { CursorResources, EffortLevel, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

const EMPTY_MODELS: ModelOption[] = []

/**
 * Pick a default Cursor model from an already-filtered (enabled) catalog.
 */
export function resolveDefaultCursorSelection(models: ModelOption[]): { modelId: string; effort?: EffortLevel } {
  const model = models.find((item) => item.isDefault) ?? models[0]
  const levels = model?.supportedEffortLevels ?? []
  const effort = levels.includes('medium') ? 'medium' : levels[0]
  return { modelId: model?.id ?? '', effort }
}

/**
 * Models shown in the Cursor picker after harness settings enable/disable.
 */
export function enabledCursorModels(resources: CursorResources | null | undefined): ModelOption[] {
  if (!resources) return EMPTY_MODELS
  return filterEnabledCursorModels(resources.models, {
    disabledModelIds: resources.disabledModelIds,
  })
}

/**
 * Apply CONNECT_CURSOR payload; re-point sessions off disabled models.
 */
export function applyCursorResources(s: ChatStore, resources: CursorResources): Partial<ChatStore> {
  const enabled = enabledCursorModels(resources)
  const projects = { ...s.projectSessions }
  let changed = false
  for (const [path, project] of Object.entries(projects)) {
    const activeSid = project._activeSessionId
    if (!activeSid) continue
    const active = activeSid ? project._sessions[activeSid] : undefined
    if (!active || (active.sessionProvider !== 'cursor' && active.preferredProvider !== 'cursor')) continue
    const selected = enabled.find((model) => model.id === active.selectedModel)
    const fallback = resolveDefaultCursorSelection(enabled)
    const model = selected ?? enabled.find((item) => item.id === fallback.modelId)
    const levels = model?.supportedEffortLevels ?? []
    const effort = active.selectedEffort && levels.includes(active.selectedEffort)
      ? active.selectedEffort
      : levels.includes('medium') ? 'medium' : levels[0]
    const nextModel = model?.id ?? fallback.modelId
    // Empty catalog: `selected` is always undefined, so a `selected &&` guard
    // never trips and every CONNECT_CURSOR rewrite mints new session objects.
    if (active.selectedModel === nextModel && active.selectedEffort === effort) continue
    projects[path] = {
      ...project,
      _sessions: {
        ...project._sessions,
        [activeSid]: {
          ...active,
          selectedModel: nextModel,
          selectedEffort: effort,
        },
      },
    }
    changed = true
  }
  return {
    harnessResources: { ...s.harnessResources, cursor: resources },
    ...(changed ? { projectSessions: projects } : {}),
  }
}
