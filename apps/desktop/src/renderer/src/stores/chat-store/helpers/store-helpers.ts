import type { AgentPrewarmHint } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState } from '../defaults'
import type { ChatStore, PerSessionState, ProjectState, SessionWriteTarget } from '../types'
import { applyCachedCodexPermissionPreset } from './prefs-cache'
import { resolveProvider } from './provider-routing'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

export function getProject(state: ChatStore, projectPath?: string | null): ProjectState {
  const key = projectPath ?? state.activeProject
  if (!key) return createDefaultProjectState()
  return state.projectSessions[key] ?? createDefaultProjectState()
}

export function getActivePerSession(state: ChatStore, projectPath?: string | null): PerSessionState {
  const proj = getProject(state, projectPath)
  if (!proj._activeSessionId) return applyCachedCodexPermissionPreset(createDefaultPerSessionState())
  return proj._sessions[proj._activeSessionId] ?? applyCachedCodexPermissionPreset(createDefaultPerSessionState())
}

/**
 * The half of the directory set this client owns — now just the session's own
 * `/add-dir` entries.
 *
 * Project workspace folders are deliberately excluded: `Session` unions those
 * in from its own authoritative read, on both `send` and `prewarm`. Echoing
 * them here would bake them into caller scope, and a later removal from Edit
 * Project could then never revoke access.
 */
export function mergeCallerScopedDirs(
  _project: ProjectState,
  session: PerSessionState,
): string[] {
  return [...new Set(session.additionalDirs)]
}

export function triggerPrewarm(state: ChatStore, projectPath?: string | null): void {
  const key = projectPath ?? state.activeProject
  if (!key) return
  if (parseRemoteProjectKey(key)) return
  const session = getActivePerSession(state, key)
  const provider = resolveProvider(session)
  if (typeof window.agent?.prewarm !== 'function') return
  const dirs = mergeCallerScopedDirs(getProject(state, key), session)
  const project = getProject(state, key)
  const hint: AgentPrewarmHint = {
    provider,
    model: provider === 'codex' ? session.selectedCodexModel || undefined : session.selectedModel || undefined,
    effort: provider === 'claude' ? session.selectedEffort : undefined,
    additionalDirs: dirs.length > 0 ? dirs : undefined,
    sessionId: project._activeSessionId ?? undefined,
    worktreePath: session._worktreePath ?? undefined,
    acpAgentId: provider === 'acp' ? (session.acpAgentId ?? undefined) : undefined,
  }
  void window.agent.prewarm(key, hint).catch(() => {})
}

const PREWARM_START_DELAY_MS = 10_000
const PREWARM_KEEPALIVE_INTERVAL_MS = 30_000
const _prewarmStartTimers = new Map<string, ReturnType<typeof setTimeout>>()
const _prewarmLastSentByKey = new Map<string, number>()

export function schedulePrewarm(getState: () => ChatStore, projectPath?: string | null): void {
  const key = projectPath ?? getState().activeProject
  if (!key) return
  const now = Date.now()
  const last = _prewarmLastSentByKey.get(key) ?? 0
  if (last > 0) {
    if (now - last < PREWARM_KEEPALIVE_INTERVAL_MS) return
    _prewarmLastSentByKey.set(key, now)
    triggerPrewarm(getState(), key)
    return
  }
  if (_prewarmStartTimers.has(key)) return
  const timer = setTimeout(() => {
    _prewarmStartTimers.delete(key)
    const state = getState()
    if (getActivePerSession(state, key).draftText.length === 0) return
    _prewarmLastSentByKey.set(key, Date.now())
    triggerPrewarm(state, key)
  }, PREWARM_START_DELAY_MS)
  _prewarmStartTimers.set(key, timer)
}

export function cancelPrewarm(projectPath?: string | null): void {
  if (!projectPath) {
    for (const timer of _prewarmStartTimers.values()) clearTimeout(timer)
    _prewarmStartTimers.clear()
    _prewarmLastSentByKey.clear()
    return
  }
  const timer = _prewarmStartTimers.get(projectPath)
  if (timer) {
    clearTimeout(timer)
    _prewarmStartTimers.delete(projectPath)
  }
  _prewarmLastSentByKey.delete(projectPath)
}

export async function inheritMiniAppToolsForNewSession(
  projectPath: string,
  previousSid: string | null | undefined,
): Promise<void> {
  if (typeof window === 'undefined' || !window.miniapp?.authorize) return
  if (!previousSid) return
  const [{ useMiniAppStore }, { useChatStore }] = await Promise.all([
    import('../../miniapp'),
    import('../index'),
  ])
  const newSid = useChatStore.getState().projectSessions[projectPath]?._activeSessionId
  if (!newSid || newSid === previousSid) return
  const inherited = Object.values(useMiniAppStore.getState().openApps)
    .filter((a) => a.projectDir === projectPath && a.holderSessions.has(previousSid))
  if (inherited.length === 0) return
  const appIds = inherited.map((a) => a.entry.id)
  window.app.trace?.('miniapp.session', 'inherit-tools', { projectPath, previousSid, newSid, appIds })
  try {
    await window.miniapp.authorize(appIds, projectPath, newSid)
    useMiniAppStore.setState((s) => {
      const nextOpen = { ...s.openApps }
      for (const [key, val] of Object.entries(s.openApps)) {
        if (val.projectDir === projectPath && appIds.includes(val.entry.id)) {
          nextOpen[key] = { ...val, holderSessions: new Set([...val.holderSessions, newSid]) }
        }
      }
      return { openApps: nextOpen }
    })
  } catch (err) {
    console.error('[inheritMiniAppToolsForNewSession] authorize failed:', err)
  }
}

export function updateProjectState(
  state: ChatStore,
  projectPath: string,
  updater: (p: ProjectState) => Partial<ProjectState>,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath] ?? createDefaultProjectState()
  const updates = updater(project)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: { ...project, ...updates },
    },
  }
}

export function updatePerSession(
  state: ChatStore,
  projectPath: string,
  sessionId: string,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Partial<ChatStore> {
  const project = state.projectSessions[projectPath] ?? createDefaultProjectState()
  const session = project._sessions[sessionId] ?? applyCachedCodexPermissionPreset(createDefaultPerSessionState())
  const updates = updater(session)
  return {
    projectSessions: {
      ...state.projectSessions,
      [projectPath]: {
        ...project,
        _sessions: {
          ...project._sessions,
          [sessionId]: { ...session, ...updates },
        },
      },
    },
  }
}

export function updateActivePerSession(
  state: ChatStore,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Partial<ChatStore> {
  const key = state.activeProject
  if (!key) return {}
  const project = state.projectSessions[key] ?? createDefaultProjectState()
  const sid = project._activeSessionId
  if (!sid) return {}
  return updatePerSession(state, key, sid, updater)
}

export function resolveActiveSessionId(project: ProjectState): string | null {
  return project._activeSessionId ?? null
}

export function getScopedPerSession(state: ChatStore, target?: SessionWriteTarget): PerSessionState {
  if (!target) return getActivePerSession(state)
  const project = state.projectSessions[target.projectPath]
  return project?._sessions[target.sessionId] ?? applyCachedCodexPermissionPreset(createDefaultPerSessionState())
}

export function commitPerSession(
  state: ChatStore,
  target: SessionWriteTarget | undefined,
  updater: (s: PerSessionState) => Partial<PerSessionState>,
): Partial<ChatStore> {
  if (target) return updatePerSession(state, target.projectPath, target.sessionId, updater)
  return updateActivePerSession(state, updater)
}
