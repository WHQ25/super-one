import type { ChatMessage } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState, PersistedSessionState, ProjectState } from '../types'
import { resolveActiveSessionId } from './store-helpers'

const CODEX_LOCAL_SESSION_PREFIX = 'codex_local_'

export function _getEffectiveSessionId(project: ProjectState): string | null {
  return resolveActiveSessionId(project)
}

export function _createLocalCodexSessionId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${CODEX_LOCAL_SESSION_PREFIX}${ts}_${rand}`
}

export function _getSessionGitBranch(session: PerSessionState): string | undefined {
  return session._gitBranch ?? undefined
}

export function _getSessionWorktreePath(
  session: Pick<PerSessionState, '_worktreePath' | '_worktreeRemoved'> | null | undefined,
): string | null {
  return session?._worktreePath && !session._worktreeRemoved ? session._worktreePath : null
}

export function _getSessionCwd(
  projectPath: string,
  session: Pick<PerSessionState, '_worktreePath' | '_worktreeRemoved'> | null | undefined,
): string {
  return _getSessionWorktreePath(session) ?? projectPath
}

export function _mergePersistedMessages(savedMessages: ChatMessage[], runtimeMessages: ChatMessage[]): ChatMessage[] {
  const runtimeById = new Map(runtimeMessages.map((message) => [message.id, message]))
  const merged = savedMessages.map((message) => runtimeById.get(message.id) ?? message)
  const seen = new Set(merged.map((message) => message.id))
  for (const message of runtimeMessages) {
    if (seen.has(message.id)) continue
    merged.push(message)
    seen.add(message.id)
  }
  return merged
}

export function _mergePersistedSessionState(session: PerSessionState, saved: PersistedSessionState): PerSessionState {
  const mergedMessages = _mergePersistedMessages(saved.messages, session.messages)
  const persistedProvider = saved.provider
  return {
    ...session,
    _title: session._title ?? saved.title ?? null,
    messages: mergedMessages,
    totalCostUsd: Math.max(session.totalCostUsd, saved.totalCostUsd),
    contextTokens: Math.max(session.contextTokens, saved.contextTokens),
    sessionProvider: session.sessionProvider ?? persistedProvider,
    preferredProvider: session.sessionProvider ? session.preferredProvider : persistedProvider,
    _gitBranch: session._gitBranch ?? saved.gitBranch,
    _worktreePath: session._worktreePath ?? saved.worktreePath,
    lastAssistantMessageId: mergedMessages.findLast((message) => message.role === 'assistant')?.id ?? session.lastAssistantMessageId,
    apiProviderId: session.apiProviderId ?? saved.apiProviderId ?? null,
    _historyHydrated: true,
  }
}

export async function _ensureSessionHydrated(sessionId: string, session: PerSessionState): Promise<PerSessionState | null> {
  if (session._historyHydrated) return session
  try {
    const saved = await window.app.loadSessionState(sessionId) as PersistedSessionState | null
    if (!saved) return { ...session, _historyHydrated: true }
    return _mergePersistedSessionState(session, saved)
  } catch (err) {
    console.warn('[ensureSessionHydrated] failed:', err)
    return null
  }
}

type ChatStoreSetter = (updater: (state: ChatStore) => Partial<ChatStore>) => void

export function _hydrateSessionState(
  set: ChatStoreSetter,
  projectPath: string,
  sessionId: string,
): void {
  window.app.loadSessionState(sessionId)
    .then((saved) => {
      set((state) => {
        const project = state.projectSessions[projectPath]
        const session = project?._sessions[sessionId]
        if (!project || !session || session._historyHydrated) return {}
        const hydrated = saved
          ? _mergePersistedSessionState(session, saved as PersistedSessionState)
          : { ...session, _historyHydrated: true }
        return {
          projectSessions: {
            ...state.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: { ...project._sessions, [sessionId]: hydrated },
            },
          },
        }
      })
    })
    .catch((err) => console.warn('[sessionHydrate] failed:', err))
}
