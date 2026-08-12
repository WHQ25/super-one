import type {
  CodexCollaborationMode,
  PermissionMode,
  QuestionAnnotations,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import { ACP_PERMISSION_MODES } from '@/components/chat/acpPermissionModes'
import { CURSOR_PERMISSION_MODES } from '@/components/chat/cursorPermissionModes'
import { PERMISSION_MODES } from '@/components/chat/PermissionModeList'
import { extractModeFromSuggestions } from './chat-helpers'
import {
  ChatStoreSet,
  _buildQuestionAnswerItem,
  _computeHasPendingInteraction,
} from './lifecycle'
import { _getEffectiveSessionId } from './persistence'
import { resolveProvider } from './provider-routing'
import {
  getActivePerSession,
  getProject,
  updateActivePerSession,
  updatePerSession,
  updateProjectState,
} from './store-helpers'
import type { ChatStore, PerSessionState } from '../types'
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
): Promise<boolean> {
  const { activeProject } = get()
  if (!activeProject) return false
  const session = getActivePerSession(get(), activeProject)
  const respondedRequest = session.pendingPermissions.find((p) => p.requestId === requestId)
  if (!respondedRequest) {
    window.app.trace?.('permission.flow', 'click_miss', { reason: 'not_in_active_session_pending', activeProject }, requestId)
    return false
  }
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  window.app.trace?.('permission.flow', 'user_click', { allow, activeSid, provider: session.sessionProvider }, requestId)
  let handled = false
  try {
    const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
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
              updateActivePerSession(s, (sess) => ({
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
    const perSessionUpdate = updateActivePerSession(s, (sess) => {
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
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  // Remote node projects: UI-only until send (node has its own permission handling).
  // Never getOrCreate a desktop SessionManager entry for a remote: path.
  if (parseRemoteProjectKey(activeProject)) {
    set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
    return
  }
  await window.agent.setPermissionMode(activeProject, mode)
  set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
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
): void {
  set((s) => {
    const partial = updateActivePerSession(s, (prev) => {
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
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get(), activeProject)
  if (session.pendingQuestion && session.pendingQuestion.requestId !== requestId) return
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
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
  clearLocalPendingQuestion(set, activeProject, codexQaItem)
}

export function dismissQuestionImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get(), activeProject)
  if (session.pendingQuestion && session.pendingQuestion.requestId !== requestId) return
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid

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
  clearLocalPendingQuestion(set, activeProject, null)
}

export function respondToPlanApprovalImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
  approved: boolean,
  feedback: string | undefined,
  postApprovalMode: PermissionMode | undefined,
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get(), activeProject)
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
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
        void window.agent.setPermissionMode(activeProject, nextMode)
      }
    }
  }
  set((s) => {
    const perSessionUpdate = updateActivePerSession(s, () => ({
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
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  if (parseRemoteProjectKey(activeProject)) {
    // Node-side sandbox is not driven by desktop SessionManager; keep UI optimistic.
    const { sandboxModeToInfo } = await import('./prefs-cache')
    set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: sandboxModeToInfo(mode) })))
    return
  }
  const session = getActivePerSession(get())
  const provider = resolveProvider(session)
  if (mode !== 'off') {
    const capability = useAppStore.getState().sandboxCapability
    // Cursor uses its own SDK sandbox helpers — skip Claude's Linux conditional probe.
    if (provider !== 'cursor') {
      if (capability?.supportLevel === 'unsupported') return
      if (capability?.supportLevel === 'conditional') {
        const probe = await useAppStore.getState().probeSandbox()
        if (!probe.ok) return
      }
    } else if (capability?.supportLevel === 'unsupported') {
      return
    }
  }
  try {
    const updated = await window.agent.setSandboxMode(activeProject, mode)
    set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: updated })))
  } catch (err) {
    console.warn('[chat] setSandboxMode failed:', err)
  }
}

export function cyclePermissionModeImpl(get: () => ChatStore): void {
  const session = getActivePerSession(get())
  const provider = resolveProvider(session)
  // ACP/Grok: only modes SuperOne can drive over the wire (see acpPermissionModes).
  // OpenCode: no auto classifier. Cursor: Auto / Plan / Full Access. Claude: full cycle (excludes bypass/dontAsk).
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
  get().setPermissionMode(next)
}

export function togglePlanModeShortcutImpl(get: () => ChatStore): void {
  const session = getActivePerSession(get())
  const provider = resolveProvider(session)
  if (provider === 'codex') {
    const next: CodexCollaborationMode = session.selectedCodexCollaborationMode === 'plan' ? 'default' : 'plan'
    get().setSelectedCodexCollaborationMode(next)
    return
  }
  // ACP/Grok: plan is session/set_mode — toggle plan vs default (not permission cycle).
  if (provider === 'acp') {
    get().setPermissionMode(session.permissionMode === 'plan' ? 'default' : 'plan')
    return
  }
  // Cursor: toggle Plan vs Auto (Full Access stays reachable via selector / Shift+Tab cycle).
  if (provider === 'cursor') {
    get().setPermissionMode(session.permissionMode === 'plan' ? 'auto' : 'plan')
    return
  }
  get().cyclePermissionMode()
}

export async function setSessionApiProviderIdImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  apiProviderId: string | null,
): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  const project = getProject(get(), activeProject)
  const sessionId = project._activeSessionId
  if (!sessionId) return
  set((s) => updateActivePerSession(s, () => ({
    apiProviderId,
    slashCommandOutput: null,
  })))
  const sess = project._sessions[sessionId]
  const isCodex = (sess?.sessionProvider ?? sess?.preferredProvider ?? 'claude') === 'codex'
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
