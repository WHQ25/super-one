import type {
  CodexCollaborationMode,
  PermissionMode,
  QuestionAnnotations,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import { checkAutoModeEligibility } from '@/lib/auto-mode-eligibility'
import { ACP_PERMISSION_MODES } from '@/components/chat/acpPermissionModes'
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
  updateProjectState,
} from './store-helpers'
import type { ChatStore, PerSessionState } from '../types'
import type { NodeSessionSnapshot } from '@/lib/remote-session-messages'

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
    const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
    const remote = parseRemoteProjectKey(activeProject)
    if (remote && targetSid) {
      const decisionValue: 'allow' | 'deny' | 'allow_always' =
        decision === 'cancel' ? 'deny' : alwaysAllow ? 'allow_always' : allow ? 'allow' : 'deny'
      await window.environment.respondSessionPermission(remote.connectionId, {
        sessionId: targetSid,
        interactionId: requestId,
        decision: decisionValue,
      })
      handled = true
      // Stage 5-D: after responding, re-hydrate the node session so transcript /
      // status catch up once the turn unblocks (sendSessionMessage already returned
      // early while pendingInteraction was set).
      void (async () => {
        try {
          const remoteMsgs = await import('@/lib/remote-session-messages')
          // Poll for turn settle or a subsequent permission.
          const deadline = Date.now() + 120_000
          while (Date.now() < deadline) {
            const snap = (await window.environment.getSession(
              remote.connectionId,
              targetSid,
            )) as NodeSessionSnapshot | null
            const pending = remoteMsgs.nodePendingToPermissionRequest(snap?.pendingInteraction)
            const status = snap?.status
            const settled =
              (status && status !== 'streaming') ||
              Boolean(pending && pending.requestId !== requestId)
            if (!settled && status === 'streaming' && !pending) {
              await new Promise((r) => setTimeout(r, 80))
              continue
            }
            const providerId = snap?.harnessId || snap?.providerId || 'codex'
            const messages = remoteMsgs.transcriptToChatMessages(snap?.transcript, providerId)
            set((s) =>
              updateActivePerSession(s, (sess) => ({
                messages: messages.length > 0 ? messages : sess.messages,
                awaitingAssistantReply: Boolean(pending) || status === 'streaming',
                status: pending
                  ? 'streaming'
                  : remoteMsgs.nodeStatusToAgentStatus(status),
                pendingPermissions: pending ? [pending] : [],
                ...(snap?.title ? { _title: snap.title } : {}),
              })),
            )
            break
          }
        } catch (err) {
          console.warn('[chat] remote permission post-respond hydrate failed:', err)
        }
      })()
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
  const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
  if (parseRemoteProjectKey(activeProject)) {
    set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
    return
  }
  await window.agent.setPermissionMode(activeProject, mode)
  set((s) => updateActivePerSession(s, () => ({ permissionMode: mode })))
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
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
  if (targetSid) void window.agent.answerQuestion(targetSid, requestId, answers, annotations)
  const codexQaItem = session.sessionProvider === 'codex' && session.pendingQuestion
    ? _buildQuestionAnswerItem(session.pendingQuestion.questions, answers)
    : null
  set((s) => {
    const perSessionUpdate = updateActivePerSession(s, (prev) => {
      if (!codexQaItem) return { pendingQuestion: null }
      const lastMsg = prev.messages[prev.messages.length - 1]
      if (!lastMsg?.metadata?.codex) return { pendingQuestion: null }
      const prevCodex = lastMsg.metadata.codex
      return {
        pendingQuestion: null,
        messages: prev.messages.map((msg, i) =>
          i !== prev.messages.length - 1 ? msg : {
            ...msg,
            metadata: { ...msg.metadata, codex: { ...prevCodex, items: [...prevCodex.items, codexQaItem] } },
          },
        ),
      }
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
}

export function dismissQuestionImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  requestId: string,
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
  if (targetSid) void window.agent.dismissQuestion(targetSid, requestId)
  set((s) => {
    const perSessionUpdate = updateActivePerSession(s, () => ({ pendingQuestion: null }))
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
  const activeSid = getProject(get(), activeProject)._activeSessionId ?? undefined
  const targetSid = _getEffectiveSessionId(getProject(get(), activeProject)) ?? activeSid
  if (targetSid) window.agent.respondToPlanApproval(targetSid, requestId, approved, feedback)
  if (approved) {
    const nextMode: PermissionMode = postApprovalMode ?? 'default'
    void window.agent.setPermissionMode(activeProject, nextMode)
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
  const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
  if (parseRemoteProjectKey(activeProject)) {
    // Node-side sandbox is not driven by desktop SessionManager; keep UI optimistic.
    const { sandboxModeToInfo } = await import('./prefs-cache')
    set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: sandboxModeToInfo(mode) })))
    return
  }
  if (mode !== 'off') {
    const capability = useAppStore.getState().sandboxCapability
    if (capability?.supportLevel === 'unsupported') return
    if (capability?.supportLevel === 'conditional') {
      const probe = await useAppStore.getState().probeSandbox()
      if (!probe.ok) return
    }
  }
  const updated = await window.agent.setSandboxMode(activeProject, mode)
  set((s) => updateProjectState(s, activeProject, () => ({ sandboxInfo: updated })))
}

export function cyclePermissionModeImpl(get: () => ChatStore): void {
  const session = getActivePerSession(get())
  const provider = resolveProvider(session)
  // ACP/Grok: only modes SuperOne can drive over the wire (see acpPermissionModes).
  // OpenCode: no auto classifier. Claude: full cycle list (excludes bypass/dontAsk).
  const permissionModes: PermissionMode[] = provider === 'acp'
    ? [...ACP_PERMISSION_MODES]
    : provider === 'opencode'
      ? PERMISSION_MODES.filter((mode) => mode !== 'auto')
      : PERMISSION_MODES
  const startIdx = permissionModes.indexOf(session.permissionMode)
  const anchor = startIdx === -1 ? 0 : startIdx
  for (let step = 1; step <= permissionModes.length; step++) {
    const candidate = permissionModes[(anchor + step) % permissionModes.length]
    if (candidate === 'auto' && provider === 'claude') {
      const claude = get().harnessResources.claude
      const account = claude?.account ?? {}
      const modelInfo = claude?.models.find((model) => model.id === session.selectedModel)
      const elig = checkAutoModeEligibility({
        subscriptionType: account?.subscriptionType,
        apiProvider: account?.apiProvider,
        modelSupportsAutoMode: modelInfo?.supportsAutoMode,
      })
      if (!elig.ok) continue
    }
    get().setPermissionMode(candidate)
    return
  }
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
  const { parseRemoteProjectKey } = await import('@/lib/remote-project-key')
  const isRemote = !!parseRemoteProjectKey(activeProject)
  if (isCodex) {
    void get().refreshCodexModels(false)
  } else if (isRemote) {
    void get().refreshClaudeResources(false)
  }
}
