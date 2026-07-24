import type { CodexAgentMessageItem, PermissionMode, SandboxInfo, UserQuestion } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState, ProjectState } from '../types'
import { _getSessionCwd } from './persistence'
import { resolveActiveSessionId, updateActivePerSession } from './store-helpers'

export type ChatStoreSet = (
  partial: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>),
  replace?: false,
) => void

export async function _syncAndResumeSession(
  projectPath: string,
  sessionId: string,
  set: ChatStoreSet,
  cwd: string,
): Promise<void> {
  const result = await window.app.resumeSession(projectPath, sessionId, cwd)
  if (!result) return
  set((s) => {
    const proj = s.projectSessions[projectPath]
    if (!proj) return {}
    const sess = proj._sessions[sessionId]
    if (!sess) return {}
    const permissionChanged = sess.permissionMode !== result.permissionMode
    const sandboxChanged =
      proj.sandboxInfo.enabled !== result.sandboxInfo.enabled ||
      proj.sandboxInfo.autoAllowBash !== result.sandboxInfo.autoAllowBash
    if (!permissionChanged && !sandboxChanged) return s
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          sandboxInfo: sandboxChanged ? result.sandboxInfo : proj.sandboxInfo,
          _sessions: permissionChanged
            ? { ...proj._sessions, [sessionId]: { ...sess, permissionMode: result.permissionMode } }
            : proj._sessions,
        },
      },
    }
  })
}

export function _truncateAtCheckpoint(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  _get: () => ChatStore,
  projectPath: string,
  checkpointId: string,
): void {
  set((s) => updateActivePerSession(s, (sess) => {
    const idx = sess.messages.findIndex((m) => m.checkpointId === checkpointId)
    const truncated = idx >= 0 ? sess.messages.slice(0, idx) : sess.messages
    return { messages: truncated, session: null, totalCostUsd: 0, contextTokens: 0 }
  }))
  window.agent.truncateAtCheckpoint(projectPath, checkpointId).catch((err) => {
    console.warn('[chat] truncateAtCheckpoint failed:', err)
  })
}

export function _buildQuestionAnswerItem(
  questions: UserQuestion[],
  answers: Record<string, string>,
): CodexAgentMessageItem {
  const lines = questions.map((q) => {
    const key = q.question
    const answer = answers[key]?.trim()
    return `**${q.question}**\n${answer || '_(dismissed)_'}`
  })
  return {
    id: `qa-${Date.now()}`,
    type: 'agent_message',
    text: lines.join('\n\n'),
  }
}

export function _computeHasPendingInteraction(project: ProjectState): boolean {
  return Object.values(project._sessions).some(
    (s) => s.pendingPermissions.length > 0 || !!s.pendingQuestion || !!s.pendingPlanApproval,
  )
}

export function _isBusyStatus(status: PerSessionState['status']): boolean {
  return status === 'streaming' || status === 'background'
}

export function _isLiveSession(session: PerSessionState | undefined): boolean {
  return !!session && (
    _isBusyStatus(session.status)
    || session.pendingPermissions.length > 0
    || !!session.pendingQuestion
    || !!session.pendingPlanApproval
    || !!session.awaitingAssistantReply
  )
}

export function _needsForegroundActivation(session: PerSessionState): boolean {
  return _isBusyStatus(session.status)
    || session.pendingPermissions.length > 0
    || !!session.pendingQuestion
    || !!session.pendingPlanApproval
}

export function _parkActiveSession(
  projectPath: string,
  _activeSessionId: string | null,
  _newSessionId?: string,
): Promise<{ permissionMode: PermissionMode; sandboxInfo: SandboxInfo }> {
  return window.agent.parkSession(projectPath)
}

/**
 * Module-scoped reset-session lock. `resetSession` flips `current` to a pending
 * promise on entry and clears it on exit; concurrent sendMessage / resetSession
 * calls await `current` to serialize. Exposed as an object so the live binding
 * is shared across helper modules.
 */
export const resetLock: { current: Promise<void> | null } = { current: null }

export async function _ensureClaudeSessionReadyForSend(
  get: () => ChatStore,
  projectPath: string,
): Promise<void> {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sessionId = resolveActiveSessionId(project)
  if (!sessionId) return
  const session = project._sessions[sessionId]
  if (!session || session.sessionProvider === 'codex' || session.sessionProvider === 'acp') return
  await window.app.resumeSession(projectPath, sessionId, _getSessionCwd(projectPath, session))
}
