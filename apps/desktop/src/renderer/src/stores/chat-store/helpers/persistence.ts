import type { ChatMessage } from '@superone/shared/agent-types'
import { codexAsyncQuestionQueue, pendingCodexAsyncQuestions } from '@superone/shared/codex-async-question'
import { neutralSelection } from '@/harness-ui/neutral-selection'
import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import type { SelectionAccess } from '@/harness-ui/strategy'
import { videoGenStatusesFromMessages } from '@/components/chat/media-generation'
import type { ChatStore, PerSessionState, PersistedSessionState, ProjectState } from '../types'
import { latestCodexTodoListFromMessages } from './codex-todo'
import { findLatestCodexUsage } from './codex-usage'
import { resolveActiveSessionId } from './store-helpers'
import { loadStoredSession } from '@/lib/session-client'

/** Where a restored provider keeps its pick; an unknown provider uses the neutral fields. */
function selectionFor(provider: PerSessionState['sessionProvider']): SelectionAccess {
  return provider ? HARNESS_STRATEGIES[provider].selection : neutralSelection
}

/**
 * The DB stores harness-neutral model columns; route them back to the fields the
 * restored harness reads. A live pick the user made during async hydration wins.
 */
function restorePersistedSelection(
  session: PerSessionState,
  provider: PerSessionState['sessionProvider'],
  model: string | null | undefined,
  effort: string | null | undefined,
  modelUserChosen = true,
  effortUserChosen = true,
): Partial<PerSessionState> {
  const selection = selectionFor(provider)
  const current = selection.read(session)
  return {
    ...(!current.modelUserChosen && model ? selection.patch({ model }, { modelUserChosen }) : {}),
    ...(!current.effortUserChosen && effort ? selection.patch({ effort }, { effortUserChosen }) : {}),
  }
}

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
    // Stored by its host, so settings changes go there rather than waiting for a first send.
    hostSessionOwned: true,
    _title: session._title ?? saved.title ?? null,
    remoteController: saved.remoteController ?? session.remoteController ?? null,
    messages: mergedMessages,
    pendingAsyncQuestions: pendingCodexAsyncQuestions(mergedMessages),
    totalCostUsd: Math.max(session.totalCostUsd, saved.totalCostUsd),
    contextTokens: Math.max(session.contextTokens, saved.contextTokens),
    sessionProvider: session.sessionProvider ?? persistedProvider,
    preferredProvider: session.sessionProvider ? session.preferredProvider : persistedProvider,
    _providerSessionId: session._providerSessionId ?? saved.providerSessionId ?? null,
    _parentSessionId: saved.parentSessionId ?? null,
    _gitBranch: session._gitBranch ?? saved.gitBranch,
    _worktreePath: session._worktreePath ?? saved.worktreePath,
    lastAssistantMessageId:
      mergedMessages.findLast((message) => message.role === 'assistant' && message.providerId !== 'system')?.id
      ?? session.lastAssistantMessageId,
    apiProviderId: session.apiProviderId ?? saved.apiProviderId ?? null,
    // Codex Fast is per session, so a cold restore must bring it back. A live
    // pick still outranks the row: hydration is async and the user may have
    // toggled Fast while it was in flight.
    selectedCodexServiceTier: session.selectedCodexServiceTier ?? saved.codexServiceTier ?? null,
    acpAgentId: session.acpAgentId ?? saved.acpAgentId ?? null,
    openCodeAgentId: session.openCodeAgentId
      ?? saved.messages.findLast((message) => message.role === 'assistant')?.metadata?.agent
      ?? null,
    // The DB uses harness-neutral model columns. Route them back to the active
    // harness fields; Codex has separate picker state from Claude/ACP/OpenCode.
    // User-chosen flags protect a newer live selection during async hydration.
    ...restorePersistedSelection(session, persistedProvider, saved.selectedModel, saved.selectedEffort),
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
  const pendingAsyncQuestions = [...new Map([
    ...codexAsyncQuestionQueue(hydrated), ...codexAsyncQuestionQueue(session),
  ].map(q => [q.item.id, q])).values()]
  const restoredProvider = session.sessionProvider ?? hydrated.sessionProvider
  const hydratedPick = selectionFor(restoredProvider).read(hydrated)
  return {
    ...session,
    _title: session._title ?? hydrated._title,
    remoteController: session.remoteController ?? hydrated.remoteController ?? null,
    messages: mergedMessages,
    pendingAsyncQuestions: codexAsyncQuestionQueue({ messages: mergedMessages, pendingAsyncQuestions }),
    totalCostUsd: Math.max(session.totalCostUsd, hydrated.totalCostUsd),
    contextTokens: Math.max(session.contextTokens, hydrated.contextTokens),
    contextWindow: session.contextWindow ?? hydrated.contextWindow,
    codexUsageSnapshot: session.codexUsageSnapshot ?? hydrated.codexUsageSnapshot,
    sessionProvider: session.sessionProvider ?? hydrated.sessionProvider,
    preferredProvider: session.sessionProvider ? session.preferredProvider : hydrated.preferredProvider,
    _providerSessionId: session._providerSessionId ?? hydrated._providerSessionId,
    _parentSessionId: hydrated._parentSessionId === undefined ? session._parentSessionId : hydrated._parentSessionId,
    _gitBranch: session._gitBranch ?? hydrated._gitBranch,
    _worktreePath: session._worktreePath ?? hydrated._worktreePath,
    lastAssistantMessageId:
      mergedMessages.findLast((message) => message.role === 'assistant' && message.providerId !== 'system')?.id
      ?? session.lastAssistantMessageId,
    apiProviderId: session.apiProviderId ?? hydrated.apiProviderId,
    acpAgentId: session.acpAgentId ?? hydrated.acpAgentId,
    openCodeAgentId: session.openCodeAgentId ?? hydrated.openCodeAgentId,
    // Same restore as _mergePersistedSessionState — `...session` above would
    // otherwise pin the stub's empty harness-specific fields.
    ...restorePersistedSelection(
      session,
      restoredProvider,
      hydratedPick.model,
      hydratedPick.effort,
      hydratedPick.modelUserChosen,
      hydratedPick.effortUserChosen,
    ),
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

export async function _ensureSessionHydrated(projectPath: string, sessionId: string, session: PerSessionState): Promise<PerSessionState | null> {
  if (session._historyHydrated) return session
  try {
    const saved = await loadStoredSession(projectPath, sessionId)
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
  loadStoredSession(projectPath, sessionId)
    .then((saved) => {
      set((state) => {
        const project = state.projectSessions[projectPath]
        const session = project?._sessions[sessionId]
        if (!project || !session || session._historyHydrated) return {}
        const hydrated = saved
          ? _mergePersistedSessionState(session, saved)
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
