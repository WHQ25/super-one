import type { PermissionMode, SandboxInfo } from '@superone/shared/agent-types'
import { useActivityViewStateStore } from '../../activity-view-state'
import { useAppStore } from '../../app'
import { applyDefaultModel } from './agent-defaults'
import { resolveDefaultCodexSelection, resolveSessionCodexSelection } from './codex-helpers'
import {
  ChatStoreSet,
  _isBusyStatus,
  _isLiveSession,
  _parkActiveSession,
  resetLock,
} from './lifecycle'
import {
  _createLocalCodexSessionId,
  _getSessionCwd,
  _getSessionWorktreePath,
  _hydrateSessionState,
} from './persistence'
import { defaultPrefsCache, sandboxModeToInfo } from './prefs-cache'
import {
  getActivePerSession,
  getProject,
  inheritMiniAppToolsForNewSession,
  resolveActiveSessionId,
  updateActivePerSession,
} from './store-helpers'
import { createDefaultPerSessionState, createDefaultProjectState, createSessionId, freshSubagentColorPool } from '../defaults'
import { isRemoteSession, removeRemoteSession } from '../index'
import type { ChatProvider, ChatStore } from '../types'

export async function focusProjectImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
): Promise<void> {
  const currentProject = get().activeProject
  if (currentProject && currentProject !== projectPath) {
    const project = get().projectSessions[currentProject]
    if (project) {
      const outgoingSid = project._activeSessionId
      const activeSession = outgoingSid ? project._sessions[outgoingSid] : null
      const isRemote = isRemoteSession(get(), currentProject, outgoingSid)
      if ((activeSession && (_isBusyStatus(activeSession.status) || activeSession.awaitingAssistantReply)) && !isRemote) {
        await _parkActiveSession(currentProject, outgoingSid)
      }
      if (outgoingSid) {
        // B1: hold the outgoing session in _sessions so Ctrl+Tab can bounce back to it even when
        // it's an idle history session that hasn't been opened in this run yet. Stub now, hydrate async.
        if (!project._sessions[outgoingSid]) {
          set((s) => {
            const proj = s.projectSessions[currentProject]
            if (!proj || proj._sessions[outgoingSid]) return {}
            const stub = createDefaultPerSessionState()
            stub.cwd = currentProject
            return {
              projectSessions: {
                ...s.projectSessions,
                [currentProject]: { ...proj, _sessions: { ...proj._sessions, [outgoingSid]: stub } },
              },
            }
          })
          _hydrateSessionState(set, currentProject, outgoingSid)
        } else if (!project._sessions[outgoingSid]._historyHydrated) {
          _hydrateSessionState(set, currentProject, outgoingSid)
        }
        set({ _previousFocusedSession: { projectPath: currentProject, sessionId: outgoingSid } })
      }
    }
  }
  const targetProject = get().projectSessions[projectPath]
  const targetSid = targetProject?._activeSessionId
  set((s) => {
    const project = s.projectSessions[projectPath]
    const updates: Partial<ChatStore> = { activeProject: projectPath }
    if (project) {
      let { unseenCompletedSessions } = project
      const nextSession = targetSid ? project._sessions[targetSid] : undefined
      const nextSessions = targetSid && nextSession
        ? {
            ...project._sessions,
            [targetSid]: { ...nextSession, cwd: _getSessionCwd(projectPath, nextSession) },
          }
        : project._sessions
      if (project._activeSessionId && unseenCompletedSessions.has(project._activeSessionId)) {
        unseenCompletedSessions = new Set(unseenCompletedSessions)
        unseenCompletedSessions.delete(project._activeSessionId)
      }
      updates.projectSessions = {
        ...s.projectSessions,
        [projectPath]: { ...project, _sessions: nextSessions, hasUnseenActivity: false, unseenCompletedSessions },
      }
    }
    return updates
  })
  // Keep the renderer's worktree root in sync with the focused session. switchSession
  // owns this for same-project hops, but a cross-project switchToSession can skip
  // switchSession entirely (target is already the destination's active session), so
  // focusProject must mirror activePath itself or the file tree shows the project root.
  const focusedSession = targetSid ? get().projectSessions[projectPath]?._sessions[targetSid] : null
  useAppStore.getState().setActiveWorktree(projectPath, _getSessionWorktreePath(focusedSession))
  if (targetSid) {
    const targetSession = targetProject?._sessions[targetSid]
    try {
      await window.app.resumeSession(projectPath, targetSid, _getSessionCwd(projectPath, targetSession))
    } catch (err) { console.warn('[chat] resumeSession failed:', err) }
  }
  const switchedProject = get().projectSessions[projectPath]
  const switchedSid = switchedProject?._activeSessionId
  const switchedSession = switchedSid ? switchedProject?._sessions[switchedSid] : undefined
  const isCodexActive = (switchedSession?.sessionProvider ?? switchedSession?.preferredProvider) === 'codex'
  if (isCodexActive && switchedProject && switchedProject._codexSkills.length === 0 && !switchedProject._codexSkillsLoading) {
    void get().refreshCodexSkills(projectPath)
  }
}

export function ensureSessionImpl(set: ChatStoreSet, projectPath: string): void {
  set((s) => {
    if (s.projectSessions[projectPath]) return {}
    const project = createDefaultProjectState()
    project.agents = s.harnessResources.claude?.agents ?? []
    project.codexModels = s.harnessResources.codex?.models ?? []
    if (defaultPrefsCache.sandboxMode) project.sandboxInfo = sandboxModeToInfo(defaultPrefsCache.sandboxMode)
    const draftId = createSessionId()
    project._activeSessionId = draftId
    const newSession = createDefaultPerSessionState()
    newSession.cwd = projectPath
    if (defaultPrefsCache.permissionMode) newSession.permissionMode = defaultPrefsCache.permissionMode
    applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
    const codexSelection = resolveDefaultCodexSelection(project.codexModels)
    newSession.selectedCodexModel = codexSelection.modelId
    newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    project._sessions = { [draftId]: newSession }
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: project,
      },
    }
  })
}

export function disconnectRemoteSessionImpl(set: ChatStoreSet, get: () => ChatStore): void {
  const state = get()
  const projectPath = state.activeProject
  const sid = projectPath ? state.projectSessions[projectPath]?._activeSessionId ?? undefined : undefined
  void window.agent.disconnectRemoteSession(sid)
  if (sid && projectPath) {
    set((s) => ({ remoteSessions: removeRemoteSession(s.remoteSessions, projectPath, sid) }))
  } else {
    set({ remoteSessions: {} })
  }
}

export async function interruptImpl(set: ChatStoreSet, get: () => ChatStore): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  const project = getProject(get(), activeProject)
  const sid = resolveActiveSessionId(project)
  set((s) => updateActivePerSession(s, () => ({ awaitingAssistantReply: false })))
  let interrupted = false
  try {
    interrupted = sid ? await window.agent.interrupt(sid) : false
  } catch {
    interrupted = false
  }
  if (!interrupted) {
    set((s) => updateActivePerSession(s, () => ({
      status: 'idle',
      pendingPermissions: [],
      pendingQuestion: null,
      pendingPlanApproval: null,
    })))
  }
}

export function clearMessagesImpl(set: ChatStoreSet, get: () => ChatStore): void {
  const { activeProject, _bashOutputs } = get()
  if (!activeProject) return
  const session = getActivePerSession(get())
  const sessionToolUseIds = new Set<string>()
  if (session) {
    for (const msg of session.messages) {
      for (const b of msg.content) {
        if (b.type === 'tool_use') sessionToolUseIds.add(b.toolUseId)
      }
    }
  }
  for (const id of sessionToolUseIds) {
    if (_bashOutputs[id]) window.app.unwatchBashOutput(id)
  }
  const remainingOutputs: typeof _bashOutputs = {}
  for (const [id, val] of Object.entries(_bashOutputs)) {
    if (!sessionToolUseIds.has(id)) remainingOutputs[id] = val
  }
  set((s) => ({
    ...updateActivePerSession(s, () => ({
      messages: [], session: null, totalCostUsd: 0, contextTokens: 0,
      sessionProvider: null, slashCommandOutput: null,
      pendingPermissions: [], pendingQuestion: null, pendingPlanApproval: null,
      planApprovalOutcome: null, mentions: [], subagentTokens: {},
      subagentColors: {}, _subagentColorsFree: freshSubagentColorPool(),
      todos: {}, _nextTodoId: 1, showTodos: false, _todosUserDismissed: false,
      awaitingAssistantReply: false,
      codexPlanRejectHintActive: false,
      chatInputFocusNonce: 0,
      queuedMessages: [],
    })),
    _bashOutputs: remainingOutputs,
  }))
}

export function resetSessionForWorktreeSwitchImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  opts?: { wtPath?: string; gitBranch?: string | null },
): void {
  const prevProject = get().projectSessions[projectPath]
  const previousSid = prevProject?._activeSessionId ?? null
  const previousSession = previousSid ? prevProject?._sessions[previousSid] : undefined
  const nextProvider = previousSession?.sessionProvider ?? previousSession?.preferredProvider ?? 'claude'
  const draftId = nextProvider === 'codex' ? _createLocalCodexSessionId() : createSessionId()
  set((s) => {
    const proj = getProject(s, projectPath)
    const newSession = createDefaultPerSessionState()
    newSession.cwd = opts?.wtPath ?? projectPath
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    newSession._worktreePath = opts?.wtPath ?? null
    newSession._gitBranch = opts?.gitBranch ?? null
    if (defaultPrefsCache.permissionMode) newSession.permissionMode = defaultPrefsCache.permissionMode
    applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
    const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
    newSession.selectedCodexModel = codexSelection.modelId
    newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          _activeSessionId: draftId,
          _sessions: { ...proj._sessions, [draftId]: newSession },
        },
      },
    }
  })
  useActivityViewStateStore.getState().seedFromCurrent(draftId)
  void inheritMiniAppToolsForNewSession(projectPath, previousSid)
}

export async function resetSessionImpl(set: ChatStoreSet, get: () => ChatStore): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  const project = getProject(get())
  const activeSession = getActivePerSession(get())
  const currentSid = resolveActiveSessionId(project)
  const nextProvider = activeSession.sessionProvider ?? activeSession.preferredProvider

  // Idempotent: a pristine current session (no messages, idle, not remote, no worktree)
  // is already "a fresh session". Creating another one just stacks empty drafts in
  // _sessions, which later surface as duplicate "New session" rows in Ctrl+Tab
  // (current + previous both pinned, both falling back to the same title).
  if (
    activeSession.messages.length === 0 &&
    !_isLiveSession(activeSession) &&
    !activeSession._worktreePath &&
    !isRemoteSession(get(), activeProject, currentSid)
  ) {
    window.app.trace?.('session.lifecycle', 'resetSession:skip-pristine', { activeProject, currentSid })
    return
  }

  const newSessionId = nextProvider === 'codex' ? _createLocalCodexSessionId() : createSessionId()
  window.app.trace?.('session.lifecycle', 'resetSession', {
    activeProject,
    oldSid: currentSid,
    newSessionId,
    oldStatus: activeSession.status,
    oldAwaitingReply: activeSession.awaitingAssistantReply,
    oldProvider: activeSession.sessionProvider,
    knownSids: Object.keys(project._sessions),
  })

  set((s) => {
    const proj = getProject(s, activeProject)
    const newSession = createDefaultPerSessionState()
    newSession.cwd = activeProject
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
    const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
    newSession.selectedCodexModel = codexSelection.modelId
    newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    return {
      projectSessions: {
        ...s.projectSessions,
        [activeProject]: {
          ...proj,
          _activeSessionId: newSessionId,
          _sessions: {
            ...proj._sessions,
            [newSessionId]: newSession,
          },
        },
      },
    }
  })
  useActivityViewStateStore.getState().seedFromCurrent(newSessionId)

  let unlock!: () => void
  resetLock.current = new Promise<void>((r) => { unlock = r })

  let agentConfig: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined
  try {
    if (activeSession.sessionProvider === 'codex') {
      if (activeSession.status !== 'streaming' && currentSid) {
        await window.agent.resetSession(currentSid).catch(() => {})
      }
    } else if (
      isRemoteSession(get(), activeProject, currentSid) ||
      _isBusyStatus(activeSession.status) ||
      activeSession.awaitingAssistantReply
    ) {
      agentConfig = await _parkActiveSession(activeProject, project._activeSessionId, newSessionId)
    } else if (currentSid) {
      agentConfig = (await window.agent.resetSession(currentSid, newSessionId)) ?? undefined
    }

    await useAppStore.getState().clearWorktree(activeProject)
  } finally {
    resetLock.current = null
    unlock()
  }

  if (agentConfig) {
    set((s) => {
      const proj = s.projectSessions[activeProject]
      if (!proj) return {}
      const sess = proj._sessions[newSessionId]
      if (!sess) return {}
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            sandboxInfo: agentConfig!.sandboxInfo,
            _sessions: {
              ...proj._sessions,
              [newSessionId]: { ...sess, permissionMode: agentConfig!.permissionMode },
            },
          },
        },
      }
    })
  }

  void inheritMiniAppToolsForNewSession(activeProject, currentSid)
}

export function setPreferredProviderImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  provider: ChatProvider,
): void {
  const { activeProject } = get()
  if (!activeProject) return
  const session = getActivePerSession(get())
  if (session.sessionProvider && session.messages.length > 0) return
  if (session.sessionProvider === provider || (provider === 'claude' && !session.sessionProvider && session.preferredProvider === 'claude')) {
    return
  }
  const proj0 = getProject(get(), activeProject)
  const currentSid0 = proj0._activeSessionId
  const currentSess0 = currentSid0 ? proj0._sessions[currentSid0] : null
  const willReplaceSid = !!currentSess0 && currentSess0.messages.length === 0
  const nextSid = willReplaceSid
    ? (provider === 'codex' ? _createLocalCodexSessionId() : createSessionId())
    : null
  set((s) => {
    const proj = getProject(s, activeProject)
    const currentSid = proj._activeSessionId
    const currentSess = currentSid ? proj._sessions[currentSid] : null
    if (currentSess && nextSid) {
      const nextSessions = { ...proj._sessions }
      if (currentSid) delete nextSessions[currentSid]
      nextSessions[nextSid] = {
        ...currentSess,
        preferredProvider: provider,
        sessionProvider: provider,
        slashCommandOutput: null,
      }
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _activeSessionId: nextSid,
            _sessions: nextSessions,
          },
        },
      }
    }
    return updateActivePerSession(s, () => ({ preferredProvider: provider, sessionProvider: provider, slashCommandOutput: null }))
  })
  if (nextSid) useActivityViewStateStore.getState().seedFromCurrent(nextSid)
  if (provider === 'codex') {
    const project = getProject(get(), activeProject)
    const sess = getActivePerSession(get())
    const selected = resolveSessionCodexSelection(
      project.codexModels,
      sess.selectedCodexModel,
      sess.selectedCodexReasoningEffort,
    )
    if (
      selected.modelId !== sess.selectedCodexModel
      || selected.reasoningEffort !== sess.selectedCodexReasoningEffort
    ) {
      set((s) => updateActivePerSession(s, () => ({
        selectedCodexModel: selected.modelId,
        selectedCodexReasoningEffort: selected.reasoningEffort,
      })))
    }
    if (project._codexSkills.length === 0 && !project._codexSkillsLoading) {
      void get().refreshCodexSkills(activeProject)
    }
  }
  if (provider === 'acp') {
    void (async () => {
      try {
        const settings = await window.app.getAppSettings()
        const agentId = settings.agentPreference.acp?.selectedAgentId
          ?? get().harnessResources.acp?.selectedAgentId
          ?? 'grok-build'
        set((s) => updateActivePerSession(s, () => ({ acpAgentId: agentId })))
      } catch {
        set((s) => updateActivePerSession(s, () => ({ acpAgentId: 'grok-build' })))
      }
    })()
  }
  void get().initializeHarness(provider)
}

export function setAcpAgentIdImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  agentId: string | null,
): void {
  const session = getActivePerSession(get())
  if (session.sessionProvider && session.messages.length > 0 && session.sessionProvider !== 'acp') return
  if (session.acpAgentId === agentId) {
    const acp = get().harnessResources.acp
    if (acp?.selectedAgentId === agentId) return
  }
  set((s) => updateActivePerSession(s, () => ({ acpAgentId: agentId })))
  const acp = get().harnessResources.acp
  if (acp && acp.selectedAgentId !== agentId) {
    get().setHarnessResources('acp', { ...acp, selectedAgentId: agentId })
  }
  void window.app.saveAppSettings({
    agentPreference: {
      acp: { selectedAgentId: agentId },
    },
  }).catch((err) => console.error('[acp] persist selectedAgentId failed:', err))
}
