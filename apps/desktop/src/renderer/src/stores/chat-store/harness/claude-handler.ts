import type { ClaudeResources, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState } from '../types'
import { buildSlashCommands } from '../helpers/chat-helpers'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

/**
 * Host whose Claude accounts a `provider_changed` notice should refresh.
 * A connection id on the event wins for every harness. Without one, only
 * Claude falls back to the open remote scope, then the subscription host.
 * Null leaves the remote composer alone.
 */
export function claudeAccountRefreshHost(input: {
  harnessId: string
  connectionId?: string
  scope: string
  openHost: string | null
}): string | null {
  if (input.connectionId) return input.connectionId
  if (input.harnessId !== 'claude') return null
  if (input.scope !== 'local') return input.scope
  return input.openHost
}

/**
 * Apply a freshly-fetched ClaudeResources bundle to the store: merges global
 * slash commands with per-project skills/commands, and seeds the active
 * session's default model selection when it's still empty.
 *
 * Desktop-local only. Remote projects keep node-scoped catalogs on ProjectState
 * (`claudeModels` / slash from listSlashResources) and must not inherit local
 * harness lists.
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
    // Remote node projects never inherit desktop Claude catalogs.
    if (parseRemoteProjectKey(path)) continue
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
