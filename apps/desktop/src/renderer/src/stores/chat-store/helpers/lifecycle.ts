import type { CodexAgentMessageItem, PermissionMode, SandboxInfo, UserQuestion } from '@superone/shared/agent-types'
import type { ChatStore, PerSessionState, ProjectState } from '../types'
import { _getSessionCwd } from './persistence'
import { resolveActiveSessionId, updateActivePerSession } from './store-helpers'
import { _isBusyStatus, _isLiveSession } from './session-liveness'

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
  // Remote node projects never use the desktop SessionManager resume path.
  if (projectPath.startsWith('remote:')) return
  let result: Awaited<ReturnType<typeof window.app.resumeSession>>
  try {
    result = await window.app.resumeSession(projectPath, sessionId, cwd)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Renderer draft UUIDs are not in SessionManager until first send — expected.
    if (/session not found/i.test(msg)) return
    throw err
  }
  if (!result) return
  set((s) => {
    const proj = s.projectSessions[projectPath]
    if (!proj) return {}
    const sess = proj._sessions[sessionId]
    if (!sess) return {}
    const permissionChanged = sess.permissionMode !== result.permissionMode
    // Compared against what this session currently SHOWS — its own record if it
    // has one, the project's value otherwise. Comparing against the project alone
    // is what let a stale record survive: a cold resume that rebuilt the runtime
    // at the project setting reads as "no change" and returns early, leaving the
    // old record — which wins in `mergedView` — on top of main's answer.
    //
    // Leaving an absent record absent when it already resolves to `result` keeps
    // opening a session free of state churn; inheriting yields the same value.
    const shown = sess.sandboxInfo ?? proj.sandboxInfo
    const sandboxChanged =
      shown.enabled !== result.sandboxInfo.enabled
      || shown.autoAllowBash !== result.sandboxInfo.autoAllowBash
    if (!permissionChanged && !sandboxChanged) return s
    // `result.sandboxInfo` is main's answer for THIS session, so it is recorded on
    // the session. The project value follows only for the session that speaks for
    // it — the same rule the `init_ready` / `agent_setting_change` reducers use.
    const isActive = sessionId === proj._activeSessionId
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          sandboxInfo: sandboxChanged && isActive ? result.sandboxInfo : proj.sandboxInfo,
          _sessions: {
            ...proj._sessions,
            [sessionId]: {
              ...sess,
              ...(permissionChanged ? { permissionMode: result.permissionMode } : {}),
              ...(sandboxChanged ? { sandboxInfo: result.sandboxInfo } : {}),
            },
          },
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

// Defined in a leaf module so cycle-sensitive importers can take them directly;
// re-exported here because most call sites already import them from lifecycle.
// Imported (not `export … from`) because this module calls them itself.
export { _isBusyStatus, _isLiveSession }

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
  sessionId?: string | null,
): Promise<void> {
  const project = get().projectSessions[projectPath]
  if (!project) return
  const sid = sessionId ?? resolveActiveSessionId(project)
  if (!sid) return
  const session = project._sessions[sid]
  if (!session || session.sessionProvider === 'codex' || session.sessionProvider === 'acp' || session.sessionProvider === 'opencode') return
  try {
    await window.app.resumeSession(projectPath, sid, _getSessionCwd(projectPath, session))
  } catch {
    // A renderer-created draft does not exist in SessionManager or SQLite yet.
    // SEND_MESSAGE will resume it or create it with the same stable session id.
  }
}
