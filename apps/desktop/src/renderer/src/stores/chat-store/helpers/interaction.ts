import { assertCodexAccountSwitchAllowed } from '@superone/shared/codex-accounts'
import { toast } from 'sonner'
import type {
  PermissionMode,
  QuestionAnnotations,
  SandboxInfo,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import { PERMISSION_MODES } from '@/components/chat/PermissionModeList'
import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import {
  coerceSandboxModeForHarness,
  harnessSandboxSupportLevel,
} from '@/components/chat/sandboxHarness'
import { extractModeFromSuggestions } from './chat-helpers'
import {
  ChatStoreSet,
  _buildQuestionAnswerItem,
  _computeHasPendingInteraction,
} from './lifecycle'
import { resolveProvider } from './provider-routing'
import {
  commitPerSession,
  getProject,
  resolveWriteScope,
  updatePerSession,
  updateProjectState,
} from './store-helpers'
import type { ChatStore, PerSessionState, SessionWriteTarget } from '../types'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'
import { codexItemToBlocks, isLegacyCodexMessage, withCodexContent } from '@superone/shared/codex-content'
import { patchSessionSettings, respondPermission, respondPlan, respondQuestion } from '@/lib/session-client'

/** In-flight remote answer/dismiss keys: projectPath\0sessionId\0requestId */
const remoteQuestionInFlight = new Set<string>()

/** @internal test-only — clears in-flight guards between cases. */
export function _resetRemoteQuestionInFlightForTests(): void {
  remoteQuestionInFlight.clear()
}

function remoteQuestionFlightKey(
  projectPath: string,
  sessionId: string,
  requestId: string,
): string {
  return `${projectPath}\0${sessionId}\0${requestId}`
}

function withProjectPendingFlag(
  state: ChatStore,
  projectPath: string,
  partial: Partial<ChatStore>,
): Partial<ChatStore> {
  const proj = (partial.projectSessions ?? state.projectSessions)[projectPath]
  if (!proj) return partial
  return {
    projectSessions: {
      ...(partial.projectSessions ?? state.projectSessions),
      [projectPath]: {
        ...proj,
        hasPendingInteraction: _computeHasPendingInteraction(proj),
      },
    },
  }
}

export async function respondToPermissionImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  allow: boolean,
  alwaysAllow: boolean | undefined,
  reason: string | undefined,
  selectedSuggestions: number[] | undefined,
  decision: 'cancel' | undefined,
  formAnswers: Record<string, unknown> | undefined,
  target?: SessionWriteTarget,
): Promise<boolean> {
  // Scope matters more here than anywhere else in this file: the prompt is
  // rendered from the pane's own `pendingPermissions`, so resolving the project's
  // active session instead misses the requestId, returns false, and leaves the
  // pane's backend waiting on an answer that was never delivered.
  const { projectPath: activeProject, sessionId: targetSid, session } = resolveWriteScope(get(), target)
  if (!activeProject) return false
  const respondedRequest = session.pendingPermissions.find((p) => p.requestId === requestId)
  if (!respondedRequest) {
    window.app.trace?.('permission.flow', 'click_miss', { reason: 'not_in_scoped_session_pending', activeProject }, requestId)
    return false
  }
  window.app.trace?.('permission.flow', 'user_click', { allow, activeSid: targetSid, provider: session.sessionProvider }, requestId)
  const activeSid = targetSid ?? undefined
  const owner = targetSid ? { projectPath: activeProject, sessionId: targetSid } : target
  let handled = false
  try {
    if (targetSid) {
      // formAnswers carries multi-launch edits (session_agents_confirm). The host
      // refuses an answer it has no pending request for, and the prompt stays.
      await respondPermission(activeProject, {
        sessionId: targetSid,
        interactionId: requestId,
        decision: decision === 'cancel' ? 'deny' : alwaysAllow ? 'allow_always' : allow ? 'allow' : 'deny',
        ...(formAnswers ? { formAnswers } : {}),
        ...(decision === 'cancel' ? { cancel: true } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(selectedSuggestions ? { selectedSuggestions } : {}),
      })
      handled = true
    }
  } catch (err) {
    console.warn('[chat] respondToPermission failed:', err)
  }
  if (!handled) {
    window.app.trace?.('permission.flow', 'ack_miss', { activeProject, activeSid, provider: session.sessionProvider }, requestId)
    return false
  }
  set((s) => {
    if (owner && !s.projectSessions[owner.projectPath]?._sessions[owner.sessionId]) return {}
    const perSessionUpdate = commitPerSession(s, owner, (sess) => {
      const updates: Partial<PerSessionState> = {
        pendingPermissions: sess.pendingPermissions.filter((p) => p.requestId !== requestId),
      }
      if (allow && selectedSuggestions) {
        const mode = extractModeFromSuggestions(respondedRequest?.suggestions, selectedSuggestions)
        if (mode) updates.permissionMode = mode as PermissionMode
      }
      return updates
    })
    const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
    if (proj) {
      return {
        projectSessions: {
          ...(perSessionUpdate.projectSessions ?? s.projectSessions),
          [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
        },
      }
    }
    return perSessionUpdate
  })
  return true
}

export async function setPermissionModeImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  mode: PermissionMode,
  target?: SessionWriteTarget,
): Promise<void> {
  const { projectPath: activeProject, sessionId, session } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (!sessionId) return
  try {
    await patchSessionSettings(activeProject, sessionId, session, { permissionMode: mode })
  } catch (error) {
    console.warn('[chat] setPermissionMode failed:', error)
    return
  }
  // The active session may have changed while IPC was in flight. Apply only
  // to the session that initiated the request, never its replacement.
  set((s) => updatePerSession(s, activeProject, sessionId, () => ({ permissionMode: mode })))
}

/**
 * Answer or dismiss a question. The prompt stays until the host acknowledges
 * (issue #21): a rejected answer leaves it to retry, and a question the host
 * resolved some other way is cleared by its own `interaction_resolved` event.
 */
function sendQuestionResponse(
  set: ChatStoreSet,
  owner: SessionWriteTarget,
  requestId: string,
  response: { answers: unknown; dismiss?: boolean; annotations?: QuestionAnnotations },
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
): void {
  const flightKey = remoteQuestionFlightKey(owner.projectPath, owner.sessionId, requestId)
  if (remoteQuestionInFlight.has(flightKey)) return
  remoteQuestionInFlight.add(flightKey)
  void respondQuestion(owner.projectPath, {
    sessionId: owner.sessionId,
    interactionId: requestId,
    answers: response.answers,
    ...(response.dismiss ? { dismiss: true } : {}),
    ...(response.annotations ? { annotations: response.annotations as Record<string, unknown> } : {}),
  })
    .then(() => {
      clearLocalPendingQuestion(set, owner.projectPath, codexQaItem, owner)
    })
    .catch((err) => console.warn('[chat] question response failed:', err))
    .finally(() => remoteQuestionInFlight.delete(flightKey))
}

function clearLocalPendingQuestion(
  set: ChatStoreSet,
  activeProject: string,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
  target?: SessionWriteTarget,
): void {
  set((s) => {
    // Answered asynchronously: the session may be gone by now.
    if (target && !s.projectSessions[target.projectPath]?._sessions[target.sessionId]) return {}
    const partial = commitPerSession(s, target, (prev) => {
      if (!codexQaItem) return { pendingQuestion: null }
      const lastMsg = prev.messages[prev.messages.length - 1]
      if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
      const prevCodex = lastMsg.metadata.codex
      // A content-shaped turn takes the answer as content; a legacy turn keeps
      // its rows in items, and the read view is applied here like at ingress.
      const answered = isLegacyCodexMessage(lastMsg)
        ? withCodexContent({ ...lastMsg, metadata: { ...lastMsg.metadata, codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] } } })
        : { ...lastMsg, content: [...lastMsg.content, ...codexItemToBlocks(codexQaItem)] }
      return {
        pendingQuestion: null,
        messages: [...prev.messages.slice(0, -1), answered],
      }
    })
    return withProjectPendingFlag(s, activeProject, partial)
  })
}

export function answerQuestionImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  answers: Record<string, string>,
  annotations?: QuestionAnnotations,
  target?: SessionWriteTarget,
): void {
  const { projectPath: activeProject, sessionId: targetSid, session } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (session.pendingQuestion && session.pendingQuestion.requestId !== requestId) return
  const codexQaItem =
    session.sessionProvider === 'codex' && session.pendingQuestion
      ? _buildQuestionAnswerItem(session.pendingQuestion.questions, answers)
      : null

  if (targetSid) {
    sendQuestionResponse(set, { projectPath: activeProject, sessionId: targetSid }, requestId, { answers, annotations }, codexQaItem)
    return
  }
  clearLocalPendingQuestion(set, activeProject, codexQaItem, target)
}

export function dismissQuestionImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  target?: SessionWriteTarget,
): void {
  const { projectPath: activeProject, sessionId: targetSid, session } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (session.pendingQuestion && session.pendingQuestion.requestId !== requestId) return

  if (targetSid) {
    // A host without a dedicated dismiss takes the empty answers as one.
    sendQuestionResponse(set, { projectPath: activeProject, sessionId: targetSid }, requestId, { answers: {}, dismiss: true }, null)
    return
  }
  clearLocalPendingQuestion(set, activeProject, null, target)
}

export function respondToPlanApprovalImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  approved: boolean,
  feedback: string | undefined,
  postApprovalMode: PermissionMode | undefined,
  target?: SessionWriteTarget,
): void {
  const { projectPath: activeProject, sessionId: targetSid, session } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (targetSid) {
    void respondPlan(activeProject, {
      sessionId: targetSid,
      interactionId: requestId,
      decision: approved ? 'approve' : 'reject',
      options: feedback ? { feedback } : undefined,
    }).catch((error) => console.warn('[chat] plan approval response failed:', error))
    // ACP plan exit is independent of yolo baseline. Forcing `default` here
    // would notify Grok `permission_mode: ask` and wipe Auto / Always Approve.
    // Claude still leaves plan into acceptEdits / default via the post-approve toggle.
    if (approved && session.sessionProvider !== 'acp') {
      const nextMode: PermissionMode = postApprovalMode ?? 'default'
      void patchSessionSettings(activeProject, targetSid, session, { permissionMode: nextMode })
        .catch((error) => console.warn('[chat] setPermissionMode after plan approval failed:', error))
    }
  }
  set((s) => {
    const perSessionUpdate = commitPerSession(s, target, () => ({
      pendingPlanApproval: null,
      planApprovalOutcome: { approved, feedback },
      ...(approved && session.sessionProvider !== 'acp' && {
        permissionMode: (postApprovalMode ?? 'default') as PermissionMode,
      }),
    }))
    const proj = (perSessionUpdate.projectSessions ?? s.projectSessions)[activeProject]
    if (proj) {
      return {
        projectSessions: {
          ...(perSessionUpdate.projectSessions ?? s.projectSessions),
          [activeProject]: { ...proj, hasPendingInteraction: _computeHasPendingInteraction(proj) },
        },
      }
    }
    return perSessionUpdate
  })
}

export async function setSandboxModeImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  mode: SandboxMode,
  target?: SessionWriteTarget,
): Promise<void> {
  const { projectPath: activeProject, sessionId, session } = resolveWriteScope(get(), target)
  if (!activeProject) return
  // One rule, the same one the event reducers and the resume path follow: a
  // sandbox we have just learned is recorded on the session it belongs to, and
  // the project value follows only for the session that speaks for the project.
  //
  // A scoped write is one pane re-sandboxing its own runtime, so it records only
  // there — writing the project value would repaint every other pane's badge with
  // a guarantee that holds for this pane alone. An unscoped write went to the
  // project's active session, so it records on both; recording only the project
  // would leave that session's older value shadowing what was just written.
  const applyInfo = (info: SandboxInfo) => set((s) => {
    if (target) return commitPerSession(s, target, () => ({ sandboxInfo: info }))
    return updateProjectState(s, activeProject, (project) => {
      const sid = project._activeSessionId
      const session = sid ? project._sessions[sid] : undefined
      return {
        sandboxInfo: info,
        ...(session && sid
          ? { _sessions: { ...project._sessions, [sid]: { ...session, sandboxInfo: info } } }
          : {}),
      }
    })
  })
  const provider = resolveProvider(session)
  const effectiveMode = coerceSandboxModeForHarness(provider, mode)
  // This computer's sandbox support decides only for sessions this computer runs.
  if (effectiveMode !== 'off' && connectionIdForProjectKey(activeProject) === 'local') {
    const capability = useAppStore.getState().sandboxCapability
    const supportLevel = harnessSandboxSupportLevel(provider, capability?.supportLevel)
    if (supportLevel === 'unsupported') return
    if (supportLevel === 'conditional') {
      const probe = await useAppStore.getState().probeSandbox()
      if (!probe.ok) return
    }
  }
  try {
    const record = sessionId ? await patchSessionSettings(activeProject, sessionId, session, { sandboxMode: effectiveMode }) : null
    const { sandboxModeToInfo } = await import('./prefs-cache')
    applyInfo(sandboxModeToInfo((record?.sandboxMode as SandboxMode | null | undefined) ?? effectiveMode))
  } catch (err) {
    console.warn('[chat] setSandboxMode failed:', err)
  }
}

export function cyclePermissionModeImpl(get: () => ChatStore, target?: SessionWriteTarget): void {
  const { session } = resolveWriteScope(get(), target)
  const strategy = HARNESS_STRATEGIES[resolveProvider(session)]
  if (strategy.cyclePermission) {
    strategy.cyclePermission({ store: get(), session, target })
    return
  }
  // Claude's cycle excludes bypass/dontAsk.
  const permissionModes = strategy.permissionCycle ?? PERMISSION_MODES
  const startIdx = permissionModes.indexOf(session.permissionMode)
  const anchor = startIdx === -1 ? 0 : startIdx
  const next = permissionModes[(anchor + 1) % permissionModes.length]
  get().setPermissionMode(next, target)
}

export function togglePlanModeShortcutImpl(get: () => ChatStore, target?: SessionWriteTarget): void {
  const { session } = resolveWriteScope(get(), target)
  const togglePlan = HARNESS_STRATEGIES[resolveProvider(session)].togglePlan
  if (togglePlan) togglePlan({ store: get(), session, target })
  else get().cyclePermissionMode(target)
}

export async function setSessionApiProviderIdImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  apiProviderId: string | null,
  target?: SessionWriteTarget,
): Promise<void> {
  const { projectPath: activeProject, sessionId, session: sess } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (!sessionId) return
  const isCodex = (sess.sessionProvider ?? sess.preferredProvider ?? 'claude') === 'codex'
  try {
    if (isCodex) assertCodexAccountSwitchAllowed(sess.apiProviderId, apiProviderId, sess.messages.length > 0)
    await patchSessionSettings(activeProject, sessionId, sess, { apiProviderId })
    set((s) => commitPerSession(s, target, () => ({ apiProviderId, slashCommandOutput: null })))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    return
  }
  // Remote: always re-list from the node provider store. Local Codex also re-lists.
  const isRemote = connectionIdForProjectKey(activeProject) !== 'local'
  if (isCodex) {
    void get().refreshCodexModels(false)
  } else if (isRemote) {
    void get().refreshClaudeResources(false)
  } else {
    void get().loadClaudeModels(activeProject, apiProviderId, true).catch(() => {})
  }
}
