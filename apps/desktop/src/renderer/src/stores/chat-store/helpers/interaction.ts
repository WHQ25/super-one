import type {
  CodexCollaborationMode,
  PermissionMode,
  QuestionAnnotations,
  SandboxInfo,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import { ACP_PERMISSION_MODES } from '@/components/chat/acpPermissionModes'
import {
  CURSOR_DEFAULT_PERMISSION_MODE,
  CURSOR_PERMISSION_MODES,
} from '@/components/chat/cursorPermissionModes'
import { PERMISSION_MODES } from '@/components/chat/PermissionModeList'
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
import type { NodeSessionSnapshot } from '@/lib/remote-session-messages'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'

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

/**
 * Apply a node snapshot to a *specific* remote session (not whatever is active).
 * No-ops if the project/session was removed while the RPC was in flight.
 */
function applyRemoteQuestionSnapshot(
  set: ChatStoreSet,
  projectPath: string,
  targetSid: string,
  nodeSnap: NodeSessionSnapshot | null,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
  remoteMsgs: typeof import('@/lib/remote-session-messages'),
): void {
  set((s) => {
    const proj = s.projectSessions[projectPath]
    if (!proj?._sessions[targetSid]) return {}
    const pendingFields = remoteMsgs.nodePendingInteractionFields(nodeSnap?.pendingInteraction)
    const stillLive =
      pendingFields.awaitingAssistantReply || nodeSnap?.status === 'streaming'
    const providerId = nodeSnap?.harnessId || nodeSnap?.providerId || 'codex'
    const partial = updatePerSession(s, projectPath, targetSid, (sess) => {
      let messages = remoteMsgs.reconcileTranscriptWithLocalMessages(
        sess.messages,
        nodeSnap?.transcript,
        providerId,
      )
      if (codexQaItem) {
        const lastIdx = messages.length - 1
        const lastMsg = messages[lastIdx]
        if (lastMsg?.metadata?.codex) {
          const prevCodex = lastMsg.metadata.codex
          messages = messages.map((msg, i) =>
            i !== lastIdx
              ? msg
              : {
                  ...msg,
                  metadata: {
                    ...msg.metadata,
                    codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] },
                  },
                },
          )
        }
      }
      return {
        messages,
        awaitingAssistantReply: stillLive,
        status: stillLive
          ? 'streaming'
          : remoteMsgs.nodeStatusToAgentStatus(nodeSnap?.status),
        pendingPermissions: pendingFields.pendingPermissions,
        pendingQuestion: pendingFields.pendingQuestion,
        pendingPlanApproval: pendingFields.pendingPlanApproval,
        ...(nodeSnap?.title ? { _title: nodeSnap.title } : {}),
      }
    })
    return withProjectPendingFlag(s, projectPath, partial)
  })
}

/** Clear pendingQuestion only if it still matches the answered requestId. */
function clearMatchingPendingQuestion(
  set: ChatStoreSet,
  projectPath: string,
  targetSid: string,
  requestId: string,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
): void {
  set((s) => {
    const sess = s.projectSessions[projectPath]?._sessions[targetSid]
    if (!sess || sess.pendingQuestion?.requestId !== requestId) return {}
    const partial = updatePerSession(s, projectPath, targetSid, (prev) => {
      if (!codexQaItem) return { pendingQuestion: null }
      const lastMsg = prev.messages[prev.messages.length - 1]
      if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
      const prevCodex = lastMsg.metadata.codex
      return {
        pendingQuestion: null,
        messages: prev.messages.map((msg, i) =>
          i !== prev.messages.length - 1
            ? msg
            : {
                ...msg,
                metadata: {
                  ...msg.metadata,
                  codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] },
                },
              },
        ),
      }
    })
    return withProjectPendingFlag(s, projectPath, partial)
  })
}

/**
 * After respond RPC reject or hydrate failure: re-fetch node state.
 * - If the answered question is still pending on the node → keep local prompt (true fail).
 * - If the node moved on (or hydrate failed after ACK) → apply snapshot / clear matching pending.
 */
async function recoverRemoteQuestionState(
  set: ChatStoreSet,
  projectPath: string,
  connectionId: string,
  targetSid: string,
  answeredRequestId: string,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
  mode: 'after_reject' | 'after_success',
): Promise<void> {
  try {
    const remoteMsgs = await import('@/lib/remote-session-messages')
    const nodeSnap = (await window.environment.getSession(
      connectionId,
      targetSid,
    )) as NodeSessionSnapshot | null
    if (!nodeSnap) {
      if (mode === 'after_success') {
        clearMatchingPendingQuestion(set, projectPath, targetSid, answeredRequestId, codexQaItem)
      }
      return
    }
    const stillSameQuestion =
      nodeSnap.pendingInteraction?.kind === 'question' &&
      nodeSnap.pendingInteraction.interactionId === answeredRequestId
    if (mode === 'after_reject' && stillSameQuestion) {
      // Node still waiting on this interaction — leave local pendingQuestion intact.
      return
    }
    applyRemoteQuestionSnapshot(set, projectPath, targetSid, nodeSnap, codexQaItem, remoteMsgs)
  } catch (err) {
    console.warn('[chat] remote question recover failed:', err)
    if (mode === 'after_success') {
      clearMatchingPendingQuestion(set, projectPath, targetSid, answeredRequestId, codexQaItem)
    }
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
  let handled = false
  try {
    const remote = parseRemoteProjectKey(activeProject)
    if (remote && targetSid) {
      const decisionValue: 'allow' | 'deny' | 'allow_always' =
        decision === 'cancel' ? 'deny' : alwaysAllow ? 'allow_always' : allow ? 'allow' : 'deny'
      // continueDrain keeps mapping session.events → agentEventSink so tool_use
      // blocks after allow are not lost (sendSessionMessage already returned).
      // formAnswers carries multi-launch edits (session_agents_confirm).
      void window.environment
        .respondSessionPermission(remote.connectionId, {
          sessionId: targetSid,
          interactionId: requestId,
          decision: decisionValue,
          ...(formAnswers ? { formAnswers } : {}),
          ...(decision === 'cancel' ? { cancel: true } : {}),
          continueDrain: {
            projectPath: activeProject,
            providerId: session.sessionProvider || undefined,
          },
        })
        .then(async (snap) => {
          try {
            const remoteMsgs = await import('@/lib/remote-session-messages')
            const nodeSnap = (snap ??
              (await window.environment.getSession(
                remote.connectionId,
                targetSid,
              ))) as NodeSessionSnapshot | null
            const pendingFields = remoteMsgs.nodePendingInteractionFields(
              nodeSnap?.pendingInteraction,
            )
            const stillLive =
              pendingFields.awaitingAssistantReply || nodeSnap?.status === 'streaming'
            const providerId = nodeSnap?.harnessId || nodeSnap?.providerId || 'codex'
            set((s) =>
              commitPerSession(s, target, (sess) => ({
                messages: remoteMsgs.reconcileTranscriptWithLocalMessages(
                  sess.messages,
                  nodeSnap?.transcript,
                  providerId,
                ),
                awaitingAssistantReply: stillLive,
                status: stillLive
                  ? 'streaming'
                  : remoteMsgs.nodeStatusToAgentStatus(nodeSnap?.status),
                pendingPermissions: pendingFields.pendingPermissions,
                pendingQuestion: pendingFields.pendingQuestion,
                pendingPlanApproval: pendingFields.pendingPlanApproval,
                ...(nodeSnap?.title ? { _title: nodeSnap.title } : {}),
              })),
            )
          } catch (err) {
            console.warn('[chat] remote permission post-respond hydrate failed:', err)
          }
        })
      handled = true
    } else if (targetSid) {
      handled = await window.agent.respondToPermission(
        targetSid,
        requestId,
        allow,
        alwaysAllow,
        reason,
        selectedSuggestions,
        decision,
        formAnswers,
      )
    }
  } catch (err) {
    console.warn('[chat] respondToPermission failed:', err)
    return false
  }
  if (!handled) {
    window.app.trace?.('permission.flow', 'ack_miss', { activeProject, activeSid, provider: session.sessionProvider }, requestId)
    return false
  }
  set((s) => {
    const perSessionUpdate = commitPerSession(s, target, (sess) => {
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
  const { projectPath: activeProject, sessionId } = resolveWriteScope(get(), target)
  if (!activeProject) return
  if (!sessionId) return
  // Remote node projects: UI-only until send (node has its own permission handling).
  // Never getOrCreate a desktop SessionManager entry for a remote: path.
  if (parseRemoteProjectKey(activeProject)) {
    set((s) => updatePerSession(s, activeProject, sessionId, () => ({ permissionMode: mode })))
    return
  }
  try {
    await window.agent.setPermissionMode(activeProject, sessionId, mode)
  } catch (error) {
    console.warn('[chat] setPermissionMode failed:', error)
    return
  }
  // The active session may have changed while IPC was in flight. Apply only
  // to the session that initiated the request, never its replacement.
  set((s) => updatePerSession(s, activeProject, sessionId, () => ({ permissionMode: mode })))
}

/**
 * After a remote question respond/dismiss ACK, merge the node snapshot into the
 * session that answered (explicit projectPath + targetSid — not active focus).
 * Hydrate fields match the remote permission *success* path; unlike permission,
 * we do not clear pending until ACK (issue #21).
 */
async function hydrateAfterRemoteQuestionRespond(
  set: ChatStoreSet,
  projectPath: string,
  connectionId: string,
  targetSid: string,
  answeredRequestId: string,
  snap: unknown,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null = null,
): Promise<void> {
  try {
    const remoteMsgs = await import('@/lib/remote-session-messages')
    const nodeSnap = (snap ??
      (await window.environment.getSession(connectionId, targetSid))) as NodeSessionSnapshot | null
    applyRemoteQuestionSnapshot(set, projectPath, targetSid, nodeSnap, codexQaItem, remoteMsgs)
  } catch (err) {
    console.warn('[chat] remote question post-respond hydrate failed:', err)
    // RPC already succeeded — do not leave a stuck prompt inviting a doomed retry.
    await recoverRemoteQuestionState(
      set,
      projectPath,
      connectionId,
      targetSid,
      answeredRequestId,
      codexQaItem,
      'after_success',
    )
  }
}

function clearLocalPendingQuestion(
  set: ChatStoreSet,
  activeProject: string,
  codexQaItem: ReturnType<typeof _buildQuestionAnswerItem> | null,
  target?: SessionWriteTarget,
): void {
  set((s) => {
    const partial = commitPerSession(s, target, (prev) => {
      if (!codexQaItem) return { pendingQuestion: null }
      const lastMsg = prev.messages[prev.messages.length - 1]
      if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
      const prevCodex = lastMsg.metadata.codex
      return {
        pendingQuestion: null,
        messages: prev.messages.map((msg, i) =>
          i !== prev.messages.length - 1
            ? msg
            : {
                ...msg,
                metadata: {
                  ...msg.metadata,
                  codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] },
                },
              },
        ),
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
    const remote = parseRemoteProjectKey(activeProject)
    if (remote) {
      // Do not clear pendingQuestion until the node ACK succeeds (issue #21).
      // continueDrain restarts event polling only after both lease + respond win.
      const flightKey = remoteQuestionFlightKey(activeProject, targetSid, requestId)
      if (remoteQuestionInFlight.has(flightKey)) return
      remoteQuestionInFlight.add(flightKey)
      void window.environment
        .respondSessionQuestion(remote.connectionId, {
          sessionId: targetSid,
          interactionId: requestId,
          answers: { answers, annotations },
          continueDrain: {
            projectPath: activeProject,
            providerId: session.sessionProvider || undefined,
          },
        })
        .then((snap) =>
          hydrateAfterRemoteQuestionRespond(
            set,
            activeProject,
            remote.connectionId,
            targetSid,
            requestId,
            snap,
            codexQaItem,
          ),
        )
        .catch(async (err) => {
          console.warn('[chat] remote answerQuestion failed:', err)
          await recoverRemoteQuestionState(
            set,
            activeProject,
            remote.connectionId,
            targetSid,
            requestId,
            codexQaItem,
            'after_reject',
          )
        })
        .finally(() => {
          remoteQuestionInFlight.delete(flightKey)
        })
      return
    }
    void window.agent.answerQuestion(targetSid, requestId, answers, annotations)
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
    const remote = parseRemoteProjectKey(activeProject)
    if (remote) {
      // Node has no dedicated dismiss — empty answers unblock the waiter (timeout-like).
      // Same ACK-before-clear contract as answerQuestion (issue #21).
      const flightKey = remoteQuestionFlightKey(activeProject, targetSid, requestId)
      if (remoteQuestionInFlight.has(flightKey)) return
      remoteQuestionInFlight.add(flightKey)
      void window.environment
        .respondSessionQuestion(remote.connectionId, {
          sessionId: targetSid,
          interactionId: requestId,
          answers: {},
          continueDrain: {
            projectPath: activeProject,
            providerId: session.sessionProvider || undefined,
          },
        })
        .then((snap) =>
          hydrateAfterRemoteQuestionRespond(
            set,
            activeProject,
            remote.connectionId,
            targetSid,
            requestId,
            snap,
          ),
        )
        .catch(async (err) => {
          console.warn('[chat] remote dismissQuestion failed:', err)
          await recoverRemoteQuestionState(
            set,
            activeProject,
            remote.connectionId,
            targetSid,
            requestId,
            null,
            'after_reject',
          )
        })
        .finally(() => {
          remoteQuestionInFlight.delete(flightKey)
        })
      return
    }
    void window.agent.dismissQuestion(targetSid, requestId)
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
    const remote = parseRemoteProjectKey(activeProject)
    if (remote) {
      void window.environment.respondSessionPlan(remote.connectionId, {
        sessionId: targetSid,
        interactionId: requestId,
        decision: approved ? 'approve' : 'reject',
        options: feedback ? { feedback } : undefined,
        continueDrain: {
          projectPath: activeProject,
          providerId: session.sessionProvider || undefined,
        },
      })
    } else {
      window.agent.respondToPlanApproval(targetSid, requestId, approved, feedback)
      if (approved) {
        const nextMode: PermissionMode = postApprovalMode ?? 'default'
        void window.agent
          .setPermissionMode(activeProject, targetSid, nextMode)
          .catch((error) => console.warn('[chat] setPermissionMode after plan approval failed:', error))
      }
    }
  }
  set((s) => {
    const perSessionUpdate = commitPerSession(s, target, () => ({
      pendingPlanApproval: null,
      planApprovalOutcome: { approved, feedback },
      ...(approved && { permissionMode: (postApprovalMode ?? 'default') as PermissionMode }),
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
  const { projectPath: activeProject, ipcSessionId, session } = resolveWriteScope(get(), target)
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
  if (parseRemoteProjectKey(activeProject)) {
    // Node-side sandbox is not driven by desktop SessionManager; keep UI optimistic.
    const { sandboxModeToInfo } = await import('./prefs-cache')
    applyInfo(sandboxModeToInfo(mode))
    return
  }
  const provider = resolveProvider(session)
  const effectiveMode = coerceSandboxModeForHarness(provider, mode)
  if (effectiveMode !== 'off') {
    const capability = useAppStore.getState().sandboxCapability
    const supportLevel = harnessSandboxSupportLevel(provider, capability?.supportLevel)
    if (supportLevel === 'unsupported') return
    if (supportLevel === 'conditional') {
      const probe = await useAppStore.getState().probeSandbox()
      if (!probe.ok) return
    }
  }
  try {
    const updated = await window.agent.setSandboxMode(activeProject, effectiveMode, ipcSessionId)
    applyInfo(updated)
  } catch (err) {
    console.warn('[chat] setSandboxMode failed:', err)
  }
}

export function cyclePermissionModeImpl(get: () => ChatStore, target?: SessionWriteTarget): void {
  const { session } = resolveWriteScope(get(), target)
  const provider = resolveProvider(session)
  // ACP/Grok: only modes SuperOne can drive over the wire (see acpPermissionModes).
  // OpenCode: no auto classifier. Cursor: Agent / Plan / Full Access. Claude: full cycle (excludes bypass/dontAsk).
  const permissionModes: PermissionMode[] = provider === 'acp'
    ? [...ACP_PERMISSION_MODES]
    : provider === 'opencode'
      ? PERMISSION_MODES.filter((mode) => mode !== 'auto')
      : provider === 'cursor'
        ? [...CURSOR_PERMISSION_MODES]
        : PERMISSION_MODES
  const startIdx = permissionModes.indexOf(session.permissionMode)
  const anchor = startIdx === -1 ? 0 : startIdx
  const next = permissionModes[(anchor + 1) % permissionModes.length]
  get().setPermissionMode(next, target)
}

export function togglePlanModeShortcutImpl(get: () => ChatStore, target?: SessionWriteTarget): void {
  const { session } = resolveWriteScope(get(), target)
  const provider = resolveProvider(session)
  if (provider === 'codex') {
    const next: CodexCollaborationMode = session.selectedCodexCollaborationMode === 'plan' ? 'default' : 'plan'
    get().setSelectedCodexCollaborationMode(next, target)
    return
  }
  // ACP/Grok: plan is session/set_mode — toggle plan vs default (not permission cycle).
  if (provider === 'acp') {
    get().setPermissionMode(session.permissionMode === 'plan' ? 'default' : 'plan', target)
    return
  }
  // Cursor: toggle Plan vs Auto (Full Access stays reachable via selector / Shift+Tab cycle).
  if (provider === 'cursor') {
    get().setPermissionMode(
      session.permissionMode === 'plan' ? CURSOR_DEFAULT_PERMISSION_MODE : 'plan',
      target,
    )
    return
  }
  get().cyclePermissionMode(target)
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
  set((s) => commitPerSession(s, target, () => ({
    apiProviderId,
    slashCommandOutput: null,
  })))
  const isCodex = (sess.sessionProvider ?? sess.preferredProvider ?? 'claude') === 'codex'
  try {
    await window.agent.setSessionApiProvider(sessionId, apiProviderId)
  } catch (err) {
    console.warn('[chat] setSessionApiProvider failed:', err)
  }
  // Remote: always re-list from the node provider store. Local Codex also re-lists.
  const isRemote = !!parseRemoteProjectKey(activeProject)
  if (isCodex) {
    void get().refreshCodexModels(false)
  } else if (isRemote) {
    void get().refreshClaudeResources(false)
  }
}
