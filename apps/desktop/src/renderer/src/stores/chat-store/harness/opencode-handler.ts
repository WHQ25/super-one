import type { EffortLevel, ModelOption, OpenCodeResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

export function resolveDefaultOpenCodeSelection(models: ModelOption[]): { modelId: string; effort?: EffortLevel } {
  const model = models.find((item) => item.isDefault) ?? models[0]
  const levels = model?.supportedEffortLevels ?? []
  const effort = levels.includes('medium') ? 'medium' : levels[0]
  return { modelId: model?.id ?? '', effort }
}

export function applyOpenCodeResources(s: ChatStore, resources: OpenCodeResources): Partial<ChatStore> {
  const projects = { ...s.projectSessions }
  let changed = false
  for (const [path, project] of Object.entries(projects)) {
    const activeSid = project._activeSessionId
    if (!activeSid) continue
    const active = activeSid ? project._sessions[activeSid] : undefined
    if (!active || (active.sessionProvider !== 'opencode' && active.preferredProvider !== 'opencode')) continue
    if (resources.models.length === 0) continue
    const selected = resources.models.find((model) => model.id === active.selectedModel)
    const fallback = resolveDefaultOpenCodeSelection(resources.models)
    const model = selected ?? resources.models.find((item) => item.id === fallback.modelId)
    const levels = model?.supportedEffortLevels ?? []
    const effort = active.selectedEffort && levels.includes(active.selectedEffort)
      ? active.selectedEffort
      : levels.includes('medium') ? 'medium' : levels[0]
    if (selected && active.selectedEffort === effort) continue
    projects[path] = {
      ...project,
      _sessions: {
        ...project._sessions,
        [activeSid]: { ...active, selectedModel: model?.id ?? fallback.modelId, selectedEffort: effort },
      },
    }
    changed = true
  }
  return {
    harnessResources: { ...s.harnessResources, opencode: resources },
    ...(changed ? { projectSessions: projects } : {}),
  }
}
