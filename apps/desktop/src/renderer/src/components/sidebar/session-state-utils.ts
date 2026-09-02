import type {
  AskUserQuestionRequest,
  ChatMessage,
  PermissionRequest,
  PlanApprovalRequest,
} from '@superone/shared/agent-types'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'

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

export function isLiveSession(
  session:
    | {
      status?: string
      pendingPermissions?: PermissionRequest[]
      pendingQuestion?: AskUserQuestionRequest | null
      pendingPlanApproval?: PlanApprovalRequest | null
      awaitingAssistantReply?: boolean
    }
    | undefined,
  isUnseen: boolean | undefined,
  isRealtimeActive: boolean = false,
): boolean {
  return !!isUnseen
    || isRealtimeActive
    || session?.status === 'streaming'
    || session?.status === 'background'
    || (session?.pendingPermissions?.length ?? 0) > 0
    || !!session?.pendingQuestion
    || !!session?.pendingPlanApproval
    || !!session?.awaitingAssistantReply
}

export function getSessionTitle(messages: ChatMessage[] | undefined): string | null {
  if (!messages?.length) return null
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = message.content
      .flatMap((block) => block.type === 'text' ? [block.text.trim()] : [])
      .filter(Boolean)
      .join(' ')
      .trim()
    if (text) return text.slice(0, SESSION_TITLE_MAX_CHARS)
  }
  return null
}

export const DEFAULT_SESSION_TITLE = 'New session'

/**
 * Canonical session-title precedence, shared by every surface that renders a
 * session title (sidebar rows, Ctrl+Tab switcher, mini window):
 * an explicit agent/user rename wins, then the first-user-message derivation,
 * then the persisted DB title, then `terminal`.
 *
 * `terminal` defaults to {@link DEFAULT_SESSION_TITLE}; pass `''` when the caller
 * layers its own further fallback on top (e.g. the mini-window title bar).
 */
export function resolveSessionTitle(
  agentTitle: string | null | undefined,
  messages: ChatMessage[] | undefined,
  dbTitle: string | null | undefined,
  terminal: string = DEFAULT_SESSION_TITLE,
): string {
  return agentTitle ?? getSessionTitle(messages) ?? dbTitle ?? terminal
}
