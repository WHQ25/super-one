import type { EffortLevel, ModelOption } from '@superone/shared/agent-types'
import { getDefaultEffortForModel } from '../defaults'
import {
  resolveDefaultCodexSelection,
  resolveSessionCodexSelection,
  useChatStore,
} from '../index'
import type { PerSessionState, ProjectState } from '../types'
import { defaultPrefsCache } from './prefs-cache'
import { resolveProvider } from './provider-routing'

export function resolveDefaultClaudeModel(models: ModelOption[]): ModelOption | undefined {
  const preferredId = defaultPrefsCache.claudeSelection?.modelId
  if (preferredId) {
    const match = models.find((m) => m.id === preferredId)
    if (match) return match
  }
  return models[0]
}

export function resolveDefaultClaudeEffort(model: ModelOption | undefined): EffortLevel | undefined {
  const preferredEffort = defaultPrefsCache.claudeSelection?.effort
  const supported = model?.supportedEffortLevels
  if (preferredEffort && supported?.includes(preferredEffort)) {
    return preferredEffort
  }
  return getDefaultEffortForModel(model)
}

export function applyDefaultModel(session: PerSessionState, models: ModelOption[]): void {
  const defaultModel = resolveDefaultClaudeModel(models)
  if (defaultModel) {
    session.selectedModel = defaultModel.id
    const effort = resolveDefaultClaudeEffort(defaultModel)
    if (effort) session.selectedEffort = effort
  }
}

/**
 * The ONLY place switchSession dispatches on harness identity. Resolves the
 * model/effort defaults for a session based on the session's own declared
 * provider (data it already carries), never on an out-of-band identity check.
 * Returns a patch so it composes with both updatePerSession and a freshly
 * built restored session.
 */
export function applySessionAgentDefaults(
  session: PerSessionState,
  project: ProjectState,
  claudeModels: ModelOption[],
): Partial<PerSessionState> {
  const provider = resolveProvider(session)
  if (provider === 'codex') {
    const sel = resolveSessionCodexSelection(
      project.codexModels,
      session.selectedCodexModel,
      session.selectedCodexReasoningEffort,
    )
    const patch: Partial<PerSessionState> = {}
    if (sel.modelId !== session.selectedCodexModel) patch.selectedCodexModel = sel.modelId
    if (sel.reasoningEffort !== session.selectedCodexReasoningEffort) patch.selectedCodexReasoningEffort = sel.reasoningEffort
    return patch
  }
  if (provider === 'acp' || provider === 'opencode') return {}
  if (!session.selectedModel) {
    const draft = { ...session }
    applyDefaultModel(draft, claudeModels)
    return { selectedModel: draft.selectedModel, selectedEffort: draft.selectedEffort }
  }
  return {}
}

export function _computeClaudeDefaultPatch(sess: PerSessionState, models: ModelOption[]): Partial<PerSessionState> | null {
  // selectedModel is shared across harnesses — never reapply Claude defaults onto ACP/OpenCode/Codex.
  if (resolveProvider(sess) !== 'claude') return null
  if (sess.modelUserChosen && sess.effortUserChosen) return null
  if (models.length === 0) return null
  const patch: Partial<PerSessionState> = {}
  if (!sess.modelUserChosen) {
    const nextModel = resolveDefaultClaudeModel(models)
    if (nextModel && nextModel.id !== sess.selectedModel) patch.selectedModel = nextModel.id
    if (!sess.effortUserChosen) {
      const nextEffort = resolveDefaultClaudeEffort(nextModel)
      if (nextEffort !== sess.selectedEffort) patch.selectedEffort = nextEffort
    }
  } else if (!sess.effortUserChosen) {
    const activeModel = models.find((m) => m.id === sess.selectedModel)
    const nextEffort = resolveDefaultClaudeEffort(activeModel)
    if (nextEffort !== sess.selectedEffort) patch.selectedEffort = nextEffort
  }
  return Object.keys(patch).length === 0 ? null : patch
}

export function _computeCodexDefaultPatch(sess: PerSessionState, models: ModelOption[]): Partial<PerSessionState> | null {
  if (resolveProvider(sess) !== 'codex') return null
  if (sess.codexModelUserChosen && sess.codexReasoningEffortUserChosen) return null
  if (models.length === 0) return null
  const selected = resolveDefaultCodexSelection(models)
  const patch: Partial<PerSessionState> = {}
  if (!sess.codexModelUserChosen && selected.modelId && selected.modelId !== sess.selectedCodexModel) {
    patch.selectedCodexModel = selected.modelId
  }
  if (!sess.codexReasoningEffortUserChosen && selected.reasoningEffort !== sess.selectedCodexReasoningEffort) {
    patch.selectedCodexReasoningEffort = selected.reasoningEffort
  }
  return Object.keys(patch).length === 0 ? null : patch
}

export function _reapplyAgentDefaultsToSessions(kind: 'claude' | 'codex'): void {
  const state = useChatStore.getState()
  const availableModels = state.harnessResources.claude?.models ?? []
  const nextProjects: Record<string, ProjectState> = { ...state.projectSessions }
  let changed = false
  for (const [projectPath, project] of Object.entries(state.projectSessions)) {
    const codexModels = project.codexModels
    let projectChanged = false
    const nextSessions: Record<string, PerSessionState> = { ...project._sessions }
    for (const [sid, sess] of Object.entries(project._sessions)) {
      if (kind === 'claude') {
        const patch = _computeClaudeDefaultPatch(sess, availableModels)
        if (patch) {
          nextSessions[sid] = { ...sess, ...patch }
          projectChanged = true
        }
      } else {
        const patch = _computeCodexDefaultPatch(sess, codexModels)
        if (patch) {
          nextSessions[sid] = { ...sess, ...patch }
          projectChanged = true
        }
      }
    }
    if (projectChanged) {
      nextProjects[projectPath] = { ...project, _sessions: nextSessions }
      changed = true
    }
  }
  if (changed) useChatStore.setState({ projectSessions: nextProjects })
}
