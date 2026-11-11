import type { AcpResources, EffortLevel, HarnessId, ModelOption } from '@superone/shared/agent-types'
import { getDefaultEffortForModel } from '../defaults'
import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog, sessionUsesAcpHarness } from '../harness/acp-handler'
import { resolveDefaultCodexSelection, useChatStore } from '../index'
import type { PerSessionState, ProjectState } from '../types'
import { defaultPrefsCache, sessionDefaultsFor } from './prefs-cache'
import { isClaudeHarness } from '@/harness-ui/claude/is-claude-harness'
import { resolveProvider } from './provider-routing'
import { isUnsentSession } from './session-liveness'

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
 * The model/effort defaults a switched-to or restored session still lacks,
 * resolved by the harness the session declares (data it already carries),
 * never by an out-of-band identity check. Returns a patch so it composes with
 * both updatePerSession and a freshly built restored session.
 */
export function applySessionAgentDefaults(
  session: PerSessionState,
  project: ProjectState,
  claudeModels: ModelOption[],
): Partial<PerSessionState> {
  return HARNESS_STRATEGIES[resolveProvider(session)].missingDefaults(session, project, claudeModels)
}

export function _computeClaudeDefaultPatch(sess: PerSessionState, models: ModelOption[]): Partial<PerSessionState> | null {
  // selectedModel is shared across harnesses — never reapply Claude defaults onto ACP/OpenCode/Codex.
  if (!isClaudeHarness(resolveProvider(sess))) return null
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

export function _computeAcpDefaultPatch(
  sess: PerSessionState,
  acpResources: AcpResources | null | undefined,
  harnessId?: HarnessId,
): Partial<PerSessionState> | null {
  if (harnessId && resolveProvider(sess) !== harnessId) return null
  if (!sessionUsesAcpHarness(sess) || !sess.acpAgentId) return null
  if (sess.modelUserChosen && sess.effortUserChosen) return null
  const catalog = getCachedAcpCatalog(acpResources, sess.acpAgentId)
  if (!catalog || catalog.models.length === 0) return null
  const catalogPatch = sessionPatchFromAcpCatalog(catalog, {
    agentId: sess.acpAgentId,
    preferSelected: sess.modelUserChosen ? sess.selectedModel : null,
    preferModeId: sess.effortUserChosen ? sess.selectedAcpModeId : null,
  })
  const patch: Partial<PerSessionState> = {}
  if (!sess.modelUserChosen && catalogPatch.selectedModel && catalogPatch.selectedModel !== sess.selectedModel) {
    patch.selectedModel = catalogPatch.selectedModel
  }
  if (
    !sess.effortUserChosen
    && catalogPatch.selectedAcpModeId !== undefined
    && catalogPatch.selectedAcpModeId !== sess.selectedAcpModeId
  ) {
    patch.selectedAcpModeId = catalogPatch.selectedAcpModeId
  }
  return Object.keys(patch).length === 0 ? null : patch
}

export function _reapplyPermissionDefaultsToUnsentSessions(): void {
  const state = useChatStore.getState()
  const nextProjects: Record<string, ProjectState> = { ...state.projectSessions }
  let changed = false
  for (const [projectPath, project] of Object.entries(state.projectSessions)) {
    if (projectPath.startsWith('remote:')) continue
    let projectChanged = false
    const nextSessions: Record<string, PerSessionState> = { ...project._sessions }
    for (const [sid, sess] of Object.entries(project._sessions)) {
      if (!isUnsentSession(sess)) continue
      const defaults = sessionDefaultsFor(resolveProvider(sess), sess.acpAgentId)
      if (defaults.permissionMode && defaults.permissionMode !== sess.permissionMode) {
        nextSessions[sid] = { ...sess, permissionMode: defaults.permissionMode }
        projectChanged = true
      }
    }
    if (projectChanged) {
      nextProjects[projectPath] = { ...project, _sessions: nextSessions }
      changed = true
    }
  }
  if (changed) useChatStore.setState({ projectSessions: nextProjects })
}

export function _reapplyAgentDefaultsToSessions(kind: 'claude' | 'codex' | 'acp-grok' | 'acp-antigravity'): void {
  const state = useChatStore.getState()
  const localClaudeModels = state.harnessResources.claude?.models ?? []
  const nextProjects: Record<string, ProjectState> = { ...state.projectSessions }
  let changed = false
  for (const [projectPath, project] of Object.entries(state.projectSessions)) {
    if (projectPath.startsWith('remote:')) continue
    const codexModels = project.codexModels
    let projectChanged = false
    const nextSessions: Record<string, PerSessionState> = { ...project._sessions }
    for (const [sid, sess] of Object.entries(project._sessions)) {
      const patch = isClaudeHarness(kind)
        ? _computeClaudeDefaultPatch(sess, localClaudeModels)
        : kind === 'codex'
          ? _computeCodexDefaultPatch(sess, codexModels)
          : _computeAcpDefaultPatch(sess, state.harnessResources[kind], kind)
      if (patch) {
        nextSessions[sid] = { ...sess, ...patch }
        projectChanged = true
      }
    }
    if (projectChanged) {
      nextProjects[projectPath] = { ...project, _sessions: nextSessions }
      changed = true
    }
  }
  if (changed) useChatStore.setState({ projectSessions: nextProjects })
}
