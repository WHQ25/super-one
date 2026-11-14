import type {
  AskUserQuestionRequest,
  HarnessId,
  PermissionRequest,
  PlanApprovalRequest,
  SessionHistoryEntry,
} from '@superone/shared/agent-types'
export { DEFAULT_SESSION_TITLE, getSessionTitle, resolveSessionTitle } from '@/lib/session-title'

// Pending-interaction copy moved to `@superone/shared/pending-interaction` so the
// main process can build notification bodies from the same source. Re-exported
// here because the sidebar has always imported it from this module.
export {
  collabPendingReason,
  getPendingReason,
  permissionPendingReason,
  type PendingReasonT,
} from '@superone/shared/pending-interaction'

/**
 * True for an in-memory session that must never appear in a project's session
 * list — the sidebar, the Ctrl+Tab switcher, or anything else that offers
 * navigation between a project's sessions.
 *
 * A side chat is registered in `_sessions` like any other session and streams
 * like one, so every liveness check passes and the live-merge promotes it into a
 * row. But it has no database row, it is docked in the activity panel rather than
 * the chat area, and it is discarded with its tab — so the row appears mid-turn
 * and vanishes on close, which reads as a session the user just lost.
 *
 * Keyed on `_sideChatParentId` because that is the same fact the main process
 * calls `Session.ephemeral`; both sides gate on the session being disposable, not
 * on it being a side chat specifically.
 */
export function isEphemeralSession(
  session: { _sideChatParentId?: string | null } | undefined,
): boolean {
  return !!session?._sideChatParentId
}

type InputSession = {
  status?: string
  pendingPermissions?: PermissionRequest[]
  pendingQuestion?: AskUserQuestionRequest | null
  pendingPlanApproval?: PlanApprovalRequest | null
  pendingAsyncQuestions?: readonly unknown[]
  awaitingAssistantReply?: boolean
  _historyHydrated?: boolean
  activityPendingCount?: number
  _sideChatParentId?: string | null
} | undefined

/**
 * The turn is blocked on a person: a permission, a question, a plan, or the
 * same fact reported by a remote activity summary before the transcript loads.
 */
export function sessionNeedsUserInput(session: InputSession): boolean {
  if (!session || session._sideChatParentId) return false
  if ((session.pendingPermissions?.length ?? 0) > 0) return true
  if (session.pendingQuestion) return true
  if (session.pendingPlanApproval) return true
  if ((session.pendingAsyncQuestions?.length ?? 0) > 0) return true
  return session._historyHydrated !== true && (session.activityPendingCount ?? 0) > 0
}

/** Project paths that have a session waiting on the user. Stable when sorted. */
export function inputProjectPathKey(
  projectSessions: Readonly<Record<string, { _sessions?: Readonly<Record<string, InputSession>> } | undefined>>,
): string {
  const paths: string[] = []
  for (const [path, project] of Object.entries(projectSessions)) {
    const sessions = project?._sessions
    if (!sessions) continue
    for (const session of Object.values(sessions)) {
      if (sessionNeedsUserInput(session)) {
        paths.push(path)
        break
      }
    }
  }
  paths.sort()
  return paths.join('\n')
}

export function isLiveSession(
  session: InputSession,
  isUnseen: boolean | undefined,
  isRealtimeActive: boolean = false,
): boolean {
  return !!isUnseen
    || isRealtimeActive
    || session?.status === 'streaming'
    || session?.status === 'background'
    || sessionNeedsUserInput(session)
    || !!session?.awaitingAssistantReply
}

/**
 * Overlay live session brand onto a history row. Mobile-created ACP sessions
 * often land in the sidebar from `_sessions` before (or without) a DB row that
 * carries `acpAgentId` — without this, Grok paints as the generic ACP fallback.
 */
export function withLiveSessionBrand(
  entry: SessionHistoryEntry,
  live?: {
    sessionProvider?: HarnessId | null
    acpAgentId?: string | null
  } | null,
): SessionHistoryEntry {
  if (!live) return entry
  const provider = entry.provider ?? live.sessionProvider ?? undefined
  const acpAgentId = entry.acpAgentId || live.acpAgentId || undefined
  if (provider === entry.provider && acpAgentId === (entry.acpAgentId ?? undefined)) return entry
  return {
    ...entry,
    ...(provider ? { provider } : {}),
    ...(acpAgentId ? { acpAgentId } : {}),
  }
}
