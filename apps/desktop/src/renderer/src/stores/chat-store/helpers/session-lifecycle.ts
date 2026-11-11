import { resetHostSession } from '@/lib/session-client'
import type { PermissionMode, SandboxInfo } from '@superone/shared/agent-types'
import { seedNewSession } from '@/harness-ui/strategies'
import { useAppStore } from '../../app'
import {
  captureOpenDraft,
  commitCarriedDraftMaps,
  computeCarriedDraftSessions,
  hasDraftContent,
  promoteDraftIfUnsent,
} from './draft-promote'
import {
  ChatStoreSet,
  _isBusyStatus,
  _isLiveSession,
  _parkActiveSession,
  resetLock,
} from './lifecycle'
import {
  _getSessionCwd,
  _getSessionWorktreePath,
  _hydrateSessionState,
} from './persistence'
import { applyCachedCodexPermissionPreset, sessionDefaultsFor } from './prefs-cache'
import {
  getActivePerSession,
  getProject,
  inheritMiniAppToolsForNewSession,
  projectClaudeModels,
  resolveActiveSessionId,
  updatePerSession,
} from './store-helpers'
import { createDefaultPerSessionState, createSessionId } from '../defaults'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { isRemoteSession } from '../index'
import type { ChatStore } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { logWorktreeWrite } from '@superone/shared/session-worktree-log'
import { isUnsentSession } from './session-liveness'
import { environmentIdForProjectKey, selectionForNewSession } from '@superone/shared/session-location'
import { hydrateAcpCatalogForSession } from './harness-selection'
import {
  clearMessagesImpl,
  disconnectRemoteSessionImpl,
  ensureSessionImpl,
  interruptImpl,
  selectionForWorktreeSwitch,
} from './session-ensure-and-interrupt'

export {
  clearMessagesImpl,
  disconnectRemoteSessionImpl,
  ensureSessionImpl,
  interruptImpl,
}

export async function focusProjectImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  opts?: { carryOpenDraft?: boolean },
): Promise<void> {
  const currentProject = get().activeProject
  // Carry is opt-in (ProjectSelector on the new-session / draft surface).
  // Sidebar / session hops must park the draft so its project + worktree stay
  // on the draft instead of following the user and being cleared.
  const allowCarry = opts?.carryOpenDraft === true
  const carried =
    allowCarry && currentProject && currentProject !== projectPath
      ? captureOpenDraft(
          get(),
          currentProject,
          get().projectSessions[currentProject]?._activeSessionId ?? null,
        )
      : null

  if (currentProject && currentProject !== projectPath) {
    const project = get().projectSessions[currentProject]
    if (project) {
      const outgoingSid = project._activeSessionId
      if (!carried) {
        void promoteDraftIfUnsent(get(), currentProject, outgoingSid)
      }
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
            const stub = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
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
  let carriedToSid = ''
  set((s) => {
    const updates: Partial<ChatStore> = { activeProject: projectPath }
    let nextProjectSessions = s.projectSessions
    if (carried) {
      const carriedResult = computeCarriedDraftSessions(nextProjectSessions, projectPath, carried)
      nextProjectSessions = carriedResult.projectSessions
      carriedToSid = carriedResult.toSessionId
    }
    const project = nextProjectSessions[projectPath]
    if (project) {
      let { unseenCompletedSessions } = project
      const activeSid = project._activeSessionId
      const nextSession = activeSid ? project._sessions[activeSid] : undefined
      if (nextSession && isUnsentSession(nextSession)) {
        logWorktreeWrite('focusProject.cwd', {
          projectPath,
          sessionId: activeSid,
          before: nextSession.cwd,
          after: _getSessionCwd(projectPath, nextSession),
          unsent: true,
        })
      }
      const nextSessions = activeSid && nextSession
        ? {
            ...project._sessions,
            [activeSid]: { ...nextSession, cwd: _getSessionCwd(projectPath, nextSession) },
          }
        : project._sessions
      if (activeSid && unseenCompletedSessions.has(activeSid)) {
        unseenCompletedSessions = new Set(unseenCompletedSessions)
        unseenCompletedSessions.delete(activeSid)
      }
      updates.projectSessions = {
        ...nextProjectSessions,
        [projectPath]: { ...project, _sessions: nextSessions, hasUnseenActivity: false, unseenCompletedSessions },
      }
    } else if (nextProjectSessions !== s.projectSessions) {
      updates.projectSessions = nextProjectSessions
    }
    return updates
  })

  if (carried) {
    commitCarriedDraftMaps(carried, carriedToSid)
    if (carriedToSid) {
      void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
        useMosaicStore.getState().focusOrReplaceFocused(projectPath, carriedToSid)
      })
    }
  }
  const focusedSid = get().projectSessions[projectPath]?._activeSessionId
  if (focusedSid) {
    hydrateAcpCatalogForSession(set, get, projectPath, focusedSid)
  }
  const focusedSession = focusedSid ? get().projectSessions[projectPath]?._sessions[focusedSid] : null
  const focusedWorktree = _getSessionWorktreePath(focusedSession)
  logWorktreeWrite('focusProject.setActiveWorktree', {
    projectPath,
    sessionId: focusedSid ?? null,
    before: useAppStore.getState().getWorktreeState(projectPath).activePath,
    after: focusedWorktree,
    unsent: isUnsentSession(focusedSession ?? undefined),
  })
  useAppStore.getState().setActiveWorktree(projectPath, focusedWorktree)
  if (focusedSid) {
    if (focusedSession?.hostSessionOwned) {
      const { followRemoteSessionEvents } = await import('@/lib/remote-session-ops')
      followRemoteSessionEvents(projectPath, focusedSid, focusedSession)
    }
    try {
      await window.agent.activateSession(projectPath, focusedSid, _getSessionCwd(projectPath, focusedSession ?? undefined))
    } catch (err) {
      console.warn('[chat] activateSession failed:', err)
    }
  }
  const switchedProject = get().projectSessions[projectPath]
  const switchedSid = switchedProject?._activeSessionId
  const switchedSession = switchedSid ? switchedProject?._sessions[switchedSid] : undefined
  const isCodexActive = (switchedSession?.sessionProvider ?? switchedSession?.preferredProvider) === 'codex'
  if (isCodexActive && switchedProject && switchedProject._codexSkills.length === 0 && !switchedProject._codexSkillsLoading) {
    void get().refreshCodexSkills(projectPath)
  }
  const isCursorActive = (switchedSession?.sessionProvider ?? switchedSession?.preferredProvider) === 'cursor'
  if (isCursorActive && switchedProject && !switchedProject._cursorSlashItemsLoading) {
    void get().refreshCursorSlashItems(projectPath)
  }
  // Remote: warm node model catalogs once on focus (ensureSession may have already
  // kicked this off — refresh paths no-op when cache is warm / in-flight).
  if (parseRemoteProjectKey(projectPath)) {
    void Promise.all([
      get().refreshCodexModels(false),
      get().refreshClaudeResources(false),
    ])
  }
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
  // Unsent empty session: worktree is a setting, not a new conversation.
  const unsent = !!previousSession
    && previousSession.messages.length === 0
    && !_isLiveSession(previousSession)
  // The session-owned checkout is the remote-nodes experiment. With it off,
  // the file-tree mirror stays the worktree the classic chip and send read.
  const environmentSelection = useAppStore.getState().experimentalRemoteNodesEnabled
    ? selectionForWorktreeSwitch(projectPath, previousSession, opts)
    : null
  if (unsent && previousSid) {
    logWorktreeWrite('resetSessionForWorktreeSwitch.unsent', {
      projectPath,
      sessionId: previousSid,
      before: previousSession?._worktreePath ?? null,
      after: opts?.wtPath ?? null,
      unsent: true,
    })
    logWorktreeWrite('resetSessionForWorktreeSwitch.unsent.cwd', {
      projectPath,
      sessionId: previousSid,
      before: previousSession?.cwd ?? null,
      after: opts?.wtPath ?? projectPath,
      unsent: true,
    })
    set((s) => updatePerSession(s, projectPath, previousSid, () => ({
      cwd: opts?.wtPath ?? projectPath,
      _worktreePath: opts?.wtPath ?? null,
      _gitBranch: opts?.gitBranch ?? null,
      ...(environmentSelection ? { environmentSelection } : {}),
    })))
    return
  }
  const nextProvider = previousSession?.sessionProvider ?? previousSession?.preferredProvider ?? 'claude'
  const newSid = createSessionId()
  logWorktreeWrite('resetSessionForWorktreeSwitch.newSession', {
    projectPath,
    sessionId: newSid,
    before: null,
    after: opts?.wtPath ?? null,
    unsent: true,
  })
  set((s) => {
    const proj = getProject(s, projectPath)
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = opts?.wtPath ?? projectPath
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    newSession._worktreePath = opts?.wtPath ?? null
    newSession._gitBranch = opts?.gitBranch ?? null
    if (environmentSelection) newSession.environmentSelection = environmentSelection
    seedNewSession(newSession, nextProvider, {
      state: s, project: proj, claudeModels: projectClaudeModels(s, projectPath), previousSession,
    })
    // Every harness resolves its own mode now, Cursor's `agent` ladder included
    // — the carve-out this line used to need is gone.
    const switchedDefaults = sessionDefaultsFor(nextProvider, newSession.acpAgentId)
    if (switchedDefaults.permissionMode) newSession.permissionMode = switchedDefaults.permissionMode
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          _activeSessionId: newSid,
          _sessions: { ...proj._sessions, [newSid]: newSession },
        },
      },
    }
  })
  // Do not seed activity dock layout into the new session. Forked sessions that
  // share panel ids (e.g. terminal-*) can kill the underlying process from the
  // child while the parent layout still references it, leaving a stuck panel.
  void inheritMiniAppToolsForNewSession(projectPath, previousSid)
}

export async function resetSessionImpl(set: ChatStoreSet, get: () => ChatStore): Promise<void> {
  const { activeProject } = get()
  if (!activeProject) return
  const project = getProject(get())
  const activeSession = getActivePerSession(get())
  const currentSid = resolveActiveSessionId(project)
  const nextProvider = activeSession.sessionProvider ?? activeSession.preferredProvider
  const hasRealtimeTimeline = currentSid
    ? useCodexRealtimeViewStore.getState().sessions[currentSid]?.hasTimeline === true
    : false
  // Remote projects use the same draft-sid lifecycle as local: New session only
  // mints a renderer UUID. Node `session.create` happens on first send via
  // ensureHostSession (no early create, no forced codex default).
  const isRemoteProject = !!parseRemoteProjectKey(activeProject)
  const remoteNodes = useAppStore.getState().experimentalRemoteNodesEnabled === true
  const pendingCreate = remoteNodes && (
    activeSession.environmentSelection?.selection.kind === 'create'
    || !!useAppStore.getState()._worktrees[activeProject]?.pendingBaseBranch
  )

  // Idempotent: a pristine current session (no messages, idle, not a live node
  // session, no worktree) is already "a fresh session". Creating another one
  // just stacks empty drafts in _sessions (duplicate "New session" in Ctrl+Tab).
  // A composer with unsent content is NOT pristine — the user wants a clean
  // session *and* their text kept, so fall through and park it as a draft.
  // A pending create on an otherwise pristine session is reused: clear the
  // mirror and put the selection back to local, instead of leaving the empty
  // session behind.
  const otherwisePristine = activeSession.messages.length === 0
    && !hasRealtimeTimeline
    && !hasDraftContent(activeSession)
    && !_isLiveSession(activeSession)
    && !activeSession._worktreePath
    && !isRemoteSession(get(), activeProject, currentSid)
  if (otherwisePristine && !pendingCreate) {
    window.app.trace?.('session.lifecycle', 'resetSession:skip-pristine', { activeProject, currentSid })
    return
  }
  if (otherwisePristine && pendingCreate) {
    useAppStore.getState().clearWorktreeMirror(activeProject)
    const environmentId = activeSession.environmentSelection?.environmentId
      ?? environmentIdForProjectKey(activeProject)
    window.app.trace?.('session.lifecycle', 'resetSession:clear-pending-create', { activeProject, currentSid })
    set((s) => {
      const proj = getProject(s, activeProject)
      const sid = resolveActiveSessionId(proj)
      const session = sid ? proj._sessions[sid] : undefined
      if (!sid || !session) return {}
      return {
        projectSessions: {
          ...s.projectSessions,
          [activeProject]: {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [sid]: {
                ...session,
                cwd: activeProject,
                _worktreePath: null,
                _gitBranch: null,
                environmentSelection: selectionForNewSession(environmentId),
              },
            },
          },
        },
      }
    })
    return
  }

  // Persist the composer before it stops being the active session, so it shows
  // up in the sidebar's draft list instead of being stranded in _sessions.
  await promoteDraftIfUnsent(get(), activeProject, currentSid)

  // With the experiment on, clear the file-tree cache before the new session
  // becomes active. The host reset below awaits, and a draft saved in that
  // window must not copy the previous session's checkout onto the new one.
  // With it off, the mirror stays until clearWorktree, as it did before.
  if (remoteNodes) useAppStore.getState().clearWorktreeMirror(activeProject)

  const newSessionId = createSessionId()
  const freshSelection = remoteNodes
    ? selectionForNewSession(environmentIdForProjectKey(activeProject))
    : null
  window.app.trace?.('session.lifecycle', 'resetSession', {
    activeProject,
    oldSid: currentSid,
    newSessionId,
    oldStatus: activeSession.status,
    oldAwaitingReply: activeSession.awaitingAssistantReply,
    oldProvider: activeSession.sessionProvider,
    knownSids: Object.keys(project._sessions),
    isRemoteProject,
  })

  set((s) => {
    const proj = getProject(s, activeProject)
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = activeProject
    if (freshSelection) {
      newSession._worktreePath = null
      newSession._gitBranch = null
      newSession.environmentSelection = freshSelection
    }
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    // The outgoing session (captured before set()) is what a harness carries picks over from.
    seedNewSession(newSession, nextProvider, {
      state: s, project: proj, claudeModels: projectClaudeModels(s, activeProject), previousSession: activeSession,
    })
    const harnessDefaults = sessionDefaultsFor(nextProvider, newSession.acpAgentId)
    if (harnessDefaults.permissionMode) newSession.permissionMode = harnessDefaults.permissionMode
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
  logWorktreeWrite('resetSession.activeSession', {
    projectPath: activeProject,
    sessionId: newSessionId,
    before: activeSession._worktreePath,
    after: null,
    unsent: true,
  })
  logWorktreeWrite('resetSession.cwd', {
    projectPath: activeProject,
    sessionId: newSessionId,
    before: activeSession.cwd,
    after: activeProject,
    unsent: true,
  })
  // Fresh session starts with an empty activity view (no dock layout inherit).
  // See resetSessionForWorktreeSwitchImpl — shared terminal/browser panel ids
  // are not safe to fork across sessions.

  let unlock!: () => void
  resetLock.current = new Promise<void>((r) => { unlock = r })

  let agentConfig: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined
  try {
    if (activeSession.sessionProvider === 'codex') {
      if (activeSession.status !== 'streaming' && currentSid) {
        await resetHostSession(activeProject, currentSid).catch(() => {})
      }
    } else if (
      isRemoteSession(get(), activeProject, currentSid) ||
      _isBusyStatus(activeSession.status) ||
      activeSession.awaitingAssistantReply
    ) {
      agentConfig = await _parkActiveSession(activeProject, project._activeSessionId, newSessionId)
    } else if (currentSid) {
      agentConfig = (await resetHostSession(activeProject, currentSid, newSessionId)) ?? undefined
    }

    await useAppStore.getState().clearWorktree(activeProject)
    logWorktreeWrite('resetSession.clearWorktree', {
      projectPath: activeProject,
      sessionId: newSessionId,
      before: activeSession._worktreePath,
      after: useAppStore.getState().getWorktreeState(activeProject).activePath,
      unsent: true,
    })
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

export {
  setPreferredProviderImpl,
  setAcpAgentIdImpl,
  ensureAcpSlashCommandsImpl,
  hydrateAcpCatalogForSession,
} from './harness-selection'
