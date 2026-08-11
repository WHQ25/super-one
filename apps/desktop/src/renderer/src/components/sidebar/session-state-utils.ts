import type {
  AskUserQuestionRequest,
  ChatMessage,
  PermissionRequest,
  PlanApprovalRequest,
  SessionAgentLaunchProposal,
  SessionAgentRequestPayload,
} from '@superone/shared/agent-types'

/** Minimal i18n surface so pure utils stay free of react-i18next hooks. */
export type PendingReasonT = (key: string, options?: Record<string, string | number>) => string

/** Strip MCP server prefix / snake_case into a short human tool label for the sidebar chip. */
function permissionToolLabel(toolName: string, t: PendingReasonT): string {
  if (!toolName) return t('sidebar.pending.toolFallback')
  const mcp = toolName.match(/^mcp__(.+?)__(.+)$/)
  const raw = mcp ? mcp[2] : toolName
  if (raw === 'session_collab_request') return t('sidebar.pending.agentLaunch')
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || toolName
}

function launchChipName(launch: SessionAgentLaunchProposal): string {
  if (launch.mode === 'link') {
    return (launch.peerTitle || launch.name || launch.sessionId || 'session').trim()
  }
  const name = launch.name?.trim()
  if (name) return name
  return launch.agentId
}

/**
 * One-line sidebar / widget chip for session_agents_confirm.
 * Prefer agent display names over the internal tool id.
 */
export function collabPendingReason(
  payload: SessionAgentRequestPayload | undefined,
  t: PendingReasonT,
): string {
  const launches = payload?.launches ?? []
  if (launches.length === 0) return t('sidebar.pending.collabFallback')
  if (launches.length === 1) {
    const launch = launches[0]!
    const name = launchChipName(launch)
    const role = launch.role?.trim()
    return role
      ? t('sidebar.pending.collabOneWithRole', { name, role })
      : t('sidebar.pending.collabOne', { name })
  }
  if (launches.length === 2) {
    return t('sidebar.pending.collabTwo', {
      a: launchChipName(launches[0]!),
      b: launchChipName(launches[1]!),
    })
  }
  return t('sidebar.pending.collabMany', { count: launches.length })
}

function permissionPendingReason(permission: PermissionRequest, t: PendingReasonT): string {
  switch (permission.requestKind) {
    case 'session_agents_confirm':
      return collabPendingReason(permission.sessionAgentsConfirm, t)
    case 'computer_use_grant': {
      const app = permission.computerUseGrant?.app?.trim()
      return app
        ? t('sidebar.pending.allowApp', { app })
        : t('sidebar.pending.allowComputerUse')
    }
    case 'video_gen_confirm':
      return t('sidebar.pending.approveVideoGen')
    case 'config_confirm': {
      const resourceTitle = permission.configConfirm?.resource?.title?.trim()
      if (resourceTitle) return t('sidebar.pending.confirmNamed', { name: resourceTitle })
      const fieldCount = permission.configConfirm?.fields?.length ?? 0
      if (fieldCount === 1) {
        const label = permission.configConfirm?.fields?.[0]?.label?.trim()
        if (label) return t('sidebar.pending.confirmNamed', { name: label })
      }
      if (fieldCount > 1) return t('sidebar.pending.confirmSettings', { count: fieldCount })
      return t('sidebar.pending.confirmConfig')
    }
    case 'mcp_elicitation':
      return permission.message?.trim()
        || t('sidebar.pending.allowTool', {
          tool: permission.serverName?.trim() || t('sidebar.pending.toolFallback'),
        })
    default:
      return t('sidebar.pending.allowTool', {
        tool: permissionToolLabel(permission.toolName, t),
      })
  }
}

export function getPendingReason(
  permissions: PermissionRequest[] | undefined,
  question: AskUserQuestionRequest | null | undefined,
  planApproval: PlanApprovalRequest | null | undefined,
  t: PendingReasonT,
): string | null {
  if (permissions && permissions.length > 0) return permissionPendingReason(permissions[0]!, t)
  if (question) return question.questions[0]?.question ?? t('sidebar.pending.waitingInput')
  if (planApproval) return t('sidebar.pending.reviewPlan')
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
