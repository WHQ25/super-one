import type { ClaudeResources, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState } from '../types'
import { buildSlashCommands } from '../helpers/chat-helpers'

/**
 * Apply a freshly-fetched ClaudeResources bundle to the store: merges global
 * slash commands with per-project skills/commands, and seeds the active
 * session's default model selection when it's still empty.
 *
 * `applyDefaultModelFn` is injected because resolving the "preferred"
 * default reads cached user prefs (_cachedDefaultClaudeSelection) that
 * still live in index.ts. Once that cache is extracted, this can drop the
 * parameter.
 */
export function applyClaudeResources(
  s: ChatStore,
  r: ClaudeResources,
  applyDefaultModelFn: (session: PerSessionState, models: ModelOption[]) => void,
): Partial<ChatStore> {
  const disabledSet = new Set(s.disabledSkills)
  const updates: Partial<ChatStore> = {
    harnessResources: { ...s.harnessResources, claude: r },
  }
  const projects = { ...s.projectSessions }
  let changed = false
  for (const [path, project] of Object.entries(projects)) {
    if (!project._activeSessionId) continue
    const patched = { ...project }
    patched.slashCommands = buildSlashCommands(
      r.slashCommands, r.skills, r.commands,
      patched._projectSkills, patched._projectCommands, disabledSet,
    )
    const activeSid = patched._activeSessionId
    if (activeSid && patched._sessions[activeSid]) {
      const sess = patched._sessions[activeSid]
      if (!sess.selectedModel && r.models.length > 0) {
        const updated = { ...sess }
        applyDefaultModelFn(updated, r.models)
        patched._sessions = { ...patched._sessions, [activeSid]: updated }
      }
    }
    projects[path] = patched
    changed = true
  }
  if (changed) updates.projectSessions = projects
  return updates
}
