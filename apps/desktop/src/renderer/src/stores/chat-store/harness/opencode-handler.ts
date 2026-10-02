import type { EffortLevel, ModelOption, OpenCodeResources } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

export function resolveDefaultOpenCodeSelection(models: ModelOption[]): { modelId: string; effort?: EffortLevel } {
  const model = models.find((item) => item.isDefault) ?? models[0]
  const levels = model?.supportedEffortLevels ?? []
  const effort = levels.includes('medium') ? 'medium' : levels[0]
  return { modelId: model?.id ?? '', effort }
}

/**
 * Reconcile a session's OpenCode model/effort against the live catalog: keep the
 * pick while the catalog still offers it, otherwise fall back to the default.
 * Shared by applyOpenCodeResources and switchSession's cold restore — the reducer
 * does not re-run for an already-loaded catalog, so restore must validate itself.
 */
export function reconcileOpenCodeSelection(
  models: ModelOption[],
  selectedModel: string | undefined,
  selectedEffort: EffortLevel | undefined,
): { modelId: string; effort?: EffortLevel; matched: boolean } {
  const fallback = resolveDefaultOpenCodeSelection(models)
  const matched = models.find((model) => model.id === selectedModel)
  const model = matched ?? models.find((item) => item.id === fallback.modelId)
  const levels = model?.supportedEffortLevels ?? []
  const effort = selectedEffort && levels.includes(selectedEffort)
    ? selectedEffort
    : levels.includes('medium') ? 'medium' : levels[0]
  return { modelId: model?.id ?? fallback.modelId, effort, matched: Boolean(matched) }
}

export function applyOpenCodeResources(s: ChatStore, resources: OpenCodeResources): Partial<ChatStore> {
  const projects = { ...s.projectSessions }
  let changed = false
  for (const [path, project] of Object.entries(projects)) {
    const activeSid = project._activeSessionId
    if (!activeSid) continue
    const active = activeSid ? project._sessions[activeSid] : undefined
    if (!active || (active.sessionProvider !== 'opencode' && active.preferredProvider !== 'opencode')) continue
    const { modelId, effort, matched } = reconcileOpenCodeSelection(
      resources.models,
      active.selectedModel,
      active.selectedEffort,
    )
    // Migrate the old Plan permission once. Any other selection stays: this
    // catalog is probed outside the project, so it lacks project-defined agents;
    // the session's own list (`session_agents`) validates the selection.
    const migratePlan = active.permissionMode === 'plan'
      && (active.sessionAgents ?? resources.agents).some((agent) => agent.id === 'plan')
    const agentId = migratePlan ? 'plan' : active.openCodeAgentId
    if (matched && active.selectedEffort === effort && active.openCodeAgentId === agentId && active.permissionMode === 'default') continue
    projects[path] = {
      ...project,
      _sessions: {
        ...project._sessions,
        [activeSid]: {
          ...active,
          selectedModel: modelId,
          selectedEffort: effort,
          openCodeAgentId: agentId,
          permissionMode: 'default',
        },
      },
    }
    changed = true
  }
  return {
    harnessResources: { ...s.harnessResources, opencode: resources },
    ...(changed ? { projectSessions: projects } : {}),
  }
}
