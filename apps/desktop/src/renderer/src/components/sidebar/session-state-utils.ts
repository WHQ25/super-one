import type { AskUserQuestionRequest, ChatMessage, PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'

export function getPendingReason(
  permissions: PermissionRequest[] | undefined,
  question: AskUserQuestionRequest | null | undefined,
  planApproval: PlanApprovalRequest | null | undefined,
): string | null {
  if (permissions && permissions.length > 0) return `Allow ${permissions[0].toolName}?`
  if (question) return question.questions[0]?.question ?? 'Waiting for input'
  if (planApproval) return 'Review plan'
  return null
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
): boolean {
  return !!isUnseen
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
    if (text) return text.slice(0, 100)
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
