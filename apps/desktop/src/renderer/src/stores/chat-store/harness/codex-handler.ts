import type { CodexReasoningEffort, CodexResources, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'

/**
 * Apply a freshly-fetched CodexResources bundle to the store: stamp models
 * onto every project, and reconcile the active session's selection if
 * either model or reasoning effort is unset.
 *
 * `resolveSessionSelectionFn` is injected because the resolver consults
 * cached user prefs (_cachedDefaultCodexSelection / localStorage) that
 * still live in index.ts. Once that cache is extracted, this can drop the
 * parameter.
 */
export function applyCodexResources(
  s: ChatStore,
  r: CodexResources,
  resolveSessionSelectionFn: (
    models: ModelOption[],
    selectedCodexModel: string,
    selectedCodexReasoningEffort?: CodexReasoningEffort,
  ) => { modelId: string; reasoningEffort?: CodexReasoningEffort },
): Partial<ChatStore> {
  const updates: Partial<ChatStore> = {
    harnessResources: { ...s.harnessResources, codex: r },
  }
  if (r.models.length === 0) return updates
  const projects = { ...s.projectSessions }
  let changed = false
  for (const [path, project] of Object.entries(projects)) {
    const patched = { ...project, codexModels: r.models }
    const activeSid = patched._activeSessionId
    if (activeSid && patched._sessions[activeSid]) {
      const sess = patched._sessions[activeSid]
      if (!sess.selectedCodexModel || !sess.selectedCodexReasoningEffort) {
        const selected = resolveSessionSelectionFn(r.models, sess.selectedCodexModel, sess.selectedCodexReasoningEffort)
        if (selected.modelId !== sess.selectedCodexModel || selected.reasoningEffort !== sess.selectedCodexReasoningEffort) {
          const updated = { ...sess, selectedCodexModel: selected.modelId, selectedCodexReasoningEffort: selected.reasoningEffort }
          patched._sessions = { ...patched._sessions, [activeSid]: updated }
        }
      }
    }
    projects[path] = patched
    changed = true
  }
  if (changed) updates.projectSessions = projects
  return updates
}
