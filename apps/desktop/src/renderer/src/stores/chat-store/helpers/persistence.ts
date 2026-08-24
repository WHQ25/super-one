import type { ChatMessage } from '@superone/shared/agent-types'
import { videoGenStatusesFromMessages } from '@/components/chat/media-generation'
import type { ChatStore, PerSessionState, PersistedSessionState, ProjectState } from '../types'
import { latestCodexTodoListFromMessages } from './codex-todo'
import { findLatestCodexUsage } from './codex-usage'
import { resolveActiveSessionId } from './store-helpers'

/** Legacy SuperOne session ids minted with a codex_local_ prefix (pre-UUID unification). */
const LEGACY_CODEX_LOCAL_SESSION_PREFIX = 'codex_local_'

/** True for historical codex_local_* session keys still present in DB / cache. */
export function _isLocalCodexSessionId(sessionId: string): boolean {
  return sessionId.startsWith(LEGACY_CODEX_LOCAL_SESSION_PREFIX)
}

export function _getEffectiveSessionId(project: ProjectState): string | null {
  return resolveActiveSessionId(project)
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
  // Derived Codex fields are not persisted as columns — rebuild from messages.
  // A live snapshot outranks the rebuild: it can be newer than the last save.
  const restoredCodexUsage = session.codexUsageSnapshot ?? findLatestCodexUsage(mergedMessages)
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
    lastAssistantMessageId:
      mergedMessages.findLast((message) => message.role === 'assistant' && message.providerId !== 'system')?.id
      ?? session.lastAssistantMessageId,
    apiProviderId: session.apiProviderId ?? saved.apiProviderId ?? null,
    acpAgentId: session.acpAgentId ?? saved.acpAgentId ?? null,
    openCodeAgentId: session.openCodeAgentId
      ?? saved.messages.findLast((message) => message.role === 'assistant')?.metadata?.agent
      ?? null,
    // Durable per-session model/effort. The default stub carries selectedModel: ''
    // (falsy but NOT nullish), so `??` would keep the empty string and let
    // applySessionAgentDefaults overwrite the restored pick with a catalog default.
    // `*UserChosen` guards a live pick made while this hydration was in flight.
    ...(!session.modelUserChosen && saved.selectedModel
      ? { selectedModel: saved.selectedModel, modelUserChosen: true }
      : {}),
    ...(!session.effortUserChosen && saved.selectedEffort
      ? { selectedEffort: saved.selectedEffort, effortUserChosen: true }
      : {}),
    // Rebuild derived UI fields — not persisted; cold restore must not leave the
    // todo popup blank or the Codex footer without a context window.
    _latestCodexTodoList: latestCodexTodoListFromMessages(mergedMessages),
    codexUsageSnapshot: restoredCodexUsage,
    contextWindow: session.contextWindow
      ?? (restoredCodexUsage?.contextWindow && restoredCodexUsage.contextWindow > 0
        ? restoredCodexUsage.contextWindow
        : null),
    videoGenStatuses: {
      ...videoGenStatusesFromMessages(mergedMessages),
      ...session.videoGenStatuses,
    },
    _historyHydrated: true,
  }
}

export function _mergeHydratedSessionState(
  session: PerSessionState,
  hydrated: PerSessionState,
): PerSessionState {
  const mergedMessages = _mergePersistedMessages(hydrated.messages, session.messages)
  return {
    ...session,
    _title: session._title ?? hydrated._title,
    messages: mergedMessages,
    totalCostUsd: Math.max(session.totalCostUsd, hydrated.totalCostUsd),
    contextTokens: Math.max(session.contextTokens, hydrated.contextTokens),
    contextWindow: session.contextWindow ?? hydrated.contextWindow,
    codexUsageSnapshot: session.codexUsageSnapshot ?? hydrated.codexUsageSnapshot,
    sessionProvider: session.sessionProvider ?? hydrated.sessionProvider,
    preferredProvider: session.sessionProvider ? session.preferredProvider : hydrated.preferredProvider,
    _gitBranch: session._gitBranch ?? hydrated._gitBranch,
    _worktreePath: session._worktreePath ?? hydrated._worktreePath,
    lastAssistantMessageId:
      mergedMessages.findLast((message) => message.role === 'assistant' && message.providerId !== 'system')?.id
      ?? session.lastAssistantMessageId,
    apiProviderId: session.apiProviderId ?? hydrated.apiProviderId,
    acpAgentId: session.acpAgentId ?? hydrated.acpAgentId,
    openCodeAgentId: session.openCodeAgentId ?? hydrated.openCodeAgentId,
    // Same restore as _mergePersistedSessionState — `hydrated` already carries the
    // persisted pick, and `...session` above would otherwise pin the stub's ''.
    ...(!session.modelUserChosen && hydrated.selectedModel
      ? { selectedModel: hydrated.selectedModel, modelUserChosen: hydrated.modelUserChosen }
      : {}),
    ...(!session.effortUserChosen && hydrated.selectedEffort
      ? { selectedEffort: hydrated.selectedEffort, effortUserChosen: hydrated.effortUserChosen }
      : {}),
    // Always re-derive: null means "cleared / all completed", not "unset".
    // `?? hydrated` would resurrect a finished list after a live clear.
    _latestCodexTodoList: latestCodexTodoListFromMessages(mergedMessages),
    videoGenStatuses: {
      ...videoGenStatusesFromMessages(mergedMessages),
      ...session.videoGenStatuses,
    },
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
