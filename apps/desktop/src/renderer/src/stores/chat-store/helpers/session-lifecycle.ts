import { isAppInputRequest } from '@superone/shared/input-request-presentation'
import type { PermissionMode, SandboxInfo } from '@superone/shared/agent-types'
import { useAppStore } from '../../app'
import { applyDefaultModel } from './agent-defaults'
import { buildSlashCommands } from './chat-helpers'
import { applyCarriedDraft, captureOpenDraft, hasDraftContent, promoteDraftIfUnsent } from './draft-promote'
import { getCachedAcpCatalog, sessionPatchFromAcpCatalog } from '../harness/acp-handler'
import { resolveDefaultCodexSelection } from './codex-helpers'
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
import { applyCachedCodexPermissionPreset, sandboxModeToInfo, sessionDefaultsFor } from './prefs-cache'
import { DEFAULT_PROVIDER } from '../event-reducer/transformers'
import {
  commitPerSession,
  getActivePerSession,
  getProject,
  inheritMiniAppToolsForNewSession,
  resolveActiveSessionId,
  resolveWriteScope,
  updateActivePerSession,
  updatePerSession,
  updateProjectState,
} from './store-helpers'
import { createDefaultPerSessionState, createDefaultProjectState, createSessionId, freshSubagentColorPool } from '../defaults'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { isRemoteSession, removeRemoteSession } from '../index'
import type { ChatStore, PerSessionState, SessionWriteTarget } from '../types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { stopBashOutputLive } from './bash-output-live'

/**
 * How long to wait for the terminal event of an acked interrupt before
 * reconciling the session to idle. Longer than the backend's own interrupt
 * watchdog so its recovery (synthetic terminal event + runtime rebuild) gets
 * the first shot.
 */
const INTERRUPT_SETTLE_TIMEOUT_MS = 12_000

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

  // After focus lands: put the carried draft into this project's unsent session
  // (or mint one). Same draft id + full new-session config — not a blank session.
  if (carried) {
    const toSid = applyCarriedDraft(set, projectPath, carried)
    if (toSid) {
      void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
        useMosaicStore.getState().focusOrReplaceFocused(projectPath, toSid)
      })
    }
  }
  // Keep the renderer's worktree root in sync with the focused session. switchSession
  // owns this for same-project hops, but a cross-project switchToSession can skip
  // switchSession entirely (target is already the destination's active session), so
  // focusProject must mirror activePath itself or the file tree shows the project root.
  // Read AFTER carry — the pre-focus targetSid is the dest's previous conversation.
  const focusedSid = get().projectSessions[projectPath]?._activeSessionId
  const focusedSession = focusedSid ? get().projectSessions[projectPath]?._sessions[focusedSid] : null
  useAppStore.getState().setActiveWorktree(projectPath, _getSessionWorktreePath(focusedSession))
  // Local: SessionManager.resume. Remote: start event drain if turn still live.
  if (targetSid) {
    const remoteKey = parseRemoteProjectKey(projectPath)
    if (remoteKey) {
      const targetSession = targetProject?._sessions[targetSid]
      if (targetSession) {
        const { resumeRemoteSessionIfLive } = await import('@/lib/remote-session-ops')
        resumeRemoteSessionIfLive(projectPath, targetSid, targetSession)
      }
    } else {
      const targetSession = targetProject?._sessions[targetSid]
      try {
        await window.app.resumeSession(projectPath, targetSid, _getSessionCwd(projectPath, targetSession))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Renderer draft UUIDs are not in SessionManager until first send — expected.
        if (!/session not found/i.test(msg)) {
          console.warn('[chat] resumeSession failed:', err)
        }
      }
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

export function ensureSessionImpl(
  set: ChatStoreSet,
  projectPath: string,
  get?: () => ChatStore,
): void {
  const isRemote = !!parseRemoteProjectKey(projectPath)
  set((s) => {
    if (s.projectSessions[projectPath]) return {}
    const project = createDefaultProjectState()
    const claude = s.harnessResources.claude
    // Remote projects must not inherit desktop harness catalogs.
    project.agents = isRemote ? [] : (claude?.agents ?? [])
    project.slashCommands = isRemote
      ? []
      : buildSlashCommands(
          claude?.slashCommands ?? [],
          claude?.skills ?? [],
          claude?.commands ?? [],
          project._projectSkills,
          project._projectCommands,
          new Set(s.disabledSkills),
        )
    project.codexModels = isRemote ? [] : (s.harnessResources.codex?.models ?? [])
    // A fresh project opens a draft on the default harness, so its defaults are
    // the ones that apply until the user switches.
    const draftDefaults = sessionDefaultsFor(DEFAULT_PROVIDER)
    if (draftDefaults.sandboxMode) project.sandboxInfo = sandboxModeToInfo(draftDefaults.sandboxMode)

    // Remote and local both need a per-session UI row so model/provider prefs stick.
    // Remote drafts use a renderer UUID that does not exist on the node yet;
    // first send goes through resolveNodeSessionId → session.create (not session.send
    // with a fake id). Without this row, updateActivePerSession no-ops (no sid) and
    // Claude model selection / preferredProvider never persist on remote projects.
    const draftId = createSessionId()
    project._activeSessionId = draftId
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = projectPath
    if (draftDefaults.permissionMode) newSession.permissionMode = draftDefaults.permissionMode
    if (!isRemote) {
      applyDefaultModel(newSession, s.harnessResources.claude?.models ?? [])
      const codexSelection = resolveDefaultCodexSelection(project.codexModels)
      newSession.selectedCodexModel = codexSelection.modelId
      newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
      newSession.selectedCodexServiceTier = codexSelection.serviceTier
    }
    project._sessions = { [draftId]: newSession }
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: project,
      },
    }
  })
  if (get && isRemote) {
    // Node discovery path: harness.resources (models + skills/commands/agents).
    // Fall back to listSlashResources + listRemoteModels when RPC is unavailable.
    void (async () => {
      try {
        const { fetchRemoteHarnessResourcesForProject } = await import(
          '@/lib/remote-harness-resources'
        )
        const bundle = await fetchRemoteHarnessResourcesForProject(projectPath)
        // Apply claude and/or codex sections from node harness.resources (no CONNECT_*).
        if (bundle && (bundle.claude || bundle.codex)) {
          const claude = bundle.claude
          const skills = Array.isArray(claude?.skills) ? claude.skills : []
          const commands = Array.isArray(claude?.commands) ? claude.commands : []
          set((s) => {
            if (!s.projectSessions[projectPath]) return {}
            const proj = s.projectSessions[projectPath]!
            return {
              harnessResources: {
                ...s.harnessResources,
                ...(claude
                  ? {
                      claude: {
                        models: claude.models ?? [],
                        account: claude.account ?? {},
                        slashCommands: claude.slashCommands ?? [],
                        skills,
                        commands,
                        agents: claude.agents ?? [],
                        outputStyles: claude.outputStyles ?? [],
                      },
                    }
                  : {}),
                ...(bundle.codex
                  ? {
                      codex: {
                        models: bundle.codex.models ?? [],
                        prompts: bundle.codex.prompts ?? [],
                      },
                    }
                  : {}),
              },
              projectSessions: {
                ...s.projectSessions,
                [projectPath]: {
                  ...proj,
                  agents: claude?.agents ?? proj.agents,
                  claudeModels: claude?.models ?? proj.claudeModels,
                  codexModels: bundle.codex?.models ?? proj.codexModels,
                  _projectSkills: skills.length > 0 ? skills : proj._projectSkills,
                  _projectCommands: commands.length > 0 ? commands : proj._projectCommands,
                  // Node discovery already merges user+project into skills/commands;
                  // feed them as project-scoped so we don't double-count.
                  slashCommands:
                    claude
                      ? buildSlashCommands(
                          claude.slashCommands ?? [],
                          [],
                          [],
                          skills,
                          commands,
                          new Set(s.disabledSkills),
                        )
                      : proj.slashCommands,
                },
              },
            }
          })
          return
        }
      } catch {
        /* fall through to legacy path */
      }
      try {
        const listed = await window.app.listSlashResources(projectPath)
        const skills = Array.isArray(listed?.skills) ? listed.skills : []
        const commands = Array.isArray(listed?.commands) ? listed.commands : []
        set((s) => {
          if (!s.projectSessions[projectPath]) return {}
          const proj = s.projectSessions[projectPath]!
          return {
            projectSessions: {
              ...s.projectSessions,
              [projectPath]: {
                ...proj,
                _projectSkills: skills,
                _projectCommands: commands,
                slashCommands: buildSlashCommands(
                  [],
                  [],
                  [],
                  skills,
                  commands,
                  new Set(s.disabledSkills),
                ),
              },
            },
          }
        })
      } catch {
        /* offline / not connected */
      }
    })()
    void get().refreshCodexModels(false)
    void get().refreshClaudeResources(false)
  }
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

export async function interruptImpl(
  set: ChatStoreSet,
  get: () => ChatStore,
  target?: SessionWriteTarget,
): Promise<void> {
  // Stop belongs to the pane that rendered it. Resolving the project's active
  // session instead interrupts the main conversation while the pane that was
  // actually asked to stop — a side chat, a background mosaic tile — keeps
  // streaming with no reachable stop control.
  const { projectPath: activeProject, sessionId: sid } = resolveWriteScope(get(), target)
  if (!activeProject) return
  set((s) => commitPerSession(s, target, () => ({ awaitingAssistantReply: false })))

  // Remote node session: EnvironmentHost → CLI session.interrupt
  const remote = parseRemoteProjectKey(activeProject)
  if (remote && sid) {
    try {
      await window.environment.interruptSession(remote.connectionId, sid)
    } catch {
      /* fall through to idle reset */
    }
    // Short drain so turnInterrupted / status events still reach the store
    // (local interrupt also relies on backend status events).
    try {
      await window.environment.resumeRemoteSessionEvents(remote.connectionId, {
        sessionId: sid,
        projectPath: activeProject,
        timeoutMs: 3_000,
      })
    } catch {
      /* ignore */
    }
    set((s) => commitPerSession(s, target, () => ({
      status: 'idle',
      awaitingAssistantReply: false,
      pendingPermissions: [],
      pendingQuestion: null,
      pendingPlanApproval: null,
    })))
    return
  }

  let interrupted = false
  try {
    interrupted = sid ? await window.agent.interrupt(sid) : false
  } catch {
    interrupted = false
  }
  if (!interrupted) {
    set((s) => commitPerSession(s, target, current => ({
      status: 'idle',
      pendingPermissions: current.pendingPermissions.filter(isAppInputRequest),
      pendingQuestion: null,
      pendingPlanApproval: null,
    })))
    return
  }
  // An acked interrupt normally lands as message_interrupted. A backend that
  // never delivers one would strand the session in `streaming` — and a
  // streaming session turns every later message into a queued (priority=next)
  // send that renders nowhere. Reconcile instead of trusting the event.
  // Detached: Stop must return as soon as the IPC does.
  if (sid) armInterruptSettleWatchdog(set, get, activeProject, sid)
}

function armInterruptSettleWatchdog(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  sessionId: string,
): void {
  const sessionAt = (): PerSessionState | undefined =>
    get().projectSessions[projectPath]?._sessions[sessionId]
  const messages = sessionAt()?.messages ?? []
  // A new turn appends a new assistant message, so a changed tail means the
  // interrupted turn is behind us and this watchdog must stand down.
  const turnTailId = messages[messages.length - 1]?.id ?? null

  setTimeout(() => {
    const session = sessionAt()
    if (session?.status !== 'streaming') return
    if ((session.messages[session.messages.length - 1]?.id ?? null) !== turnTailId) return
    console.warn('[interrupt] no terminal event after interrupt; forcing idle', { projectPath, sessionId })
    set((s) => updatePerSession(s, projectPath, sessionId, current => ({
      status: 'idle',
      pendingPermissions: current.pendingPermissions.filter(isAppInputRequest),
      pendingQuestion: null,
      pendingPlanApproval: null,
    })))
  }, INTERRUPT_SETTLE_TIMEOUT_MS)
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
    if (_bashOutputs[id]) stopBashOutputLive(id)
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
      _latestCodexTodoList: null,
      awaitingAssistantReply: false,
      codexPlanRejectHintActive: false,
      chatInputFocusNonce: 0,
      queuedMessages: [],
      _remoteTurnQueue: [],
    })),
    _bashOutputs: remainingOutputs,
  }))
}

/**
 * Seed a fresh ACP session from harness_resource_cache so model/effort selectors
 * paint immediately (same path as setPreferredProvider / setAcpAgentId / restore).
 * Without this, resetSession leaves acpAgentId=null and acpModels=[] until the
 * runtime emits acp_models — Grok "new session" looks broken.
 */
function seedAcpSessionFromCache(
  s: ChatStore,
  newSession: PerSessionState,
  previousSession?: PerSessionState | null,
): void {
  const agentId =
    previousSession?.acpAgentId
    ?? s.harnessResources.acp?.selectedAgentId
    ?? 'grok-build'
  newSession.acpAgentId = agentId
  const catalog = getCachedAcpCatalog(s.harnessResources.acp, agentId)
  if (catalog) {
    Object.assign(
      newSession,
      sessionPatchFromAcpCatalog(catalog, {
        preferSelected: previousSession?.selectedModel ?? null,
      }),
    )
    // Prefer previous effort when still in the catalog (Grok modeConfigId is null).
    const prevMode = previousSession?.selectedAcpModeId
    if (prevMode && catalog.modes.some((m) => m.id === prevMode)) {
      newSession.selectedAcpModeId = prevMode
    }
  } else {
    newSession.acpModels = []
    newSession.acpModelConfigId = null
    newSession.acpModelsStatus = 'loading'
    newSession.acpModelsError = null
    newSession.selectedModel = ''
    newSession.modelUserChosen = false
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
  if (unsent && previousSid) {
    set((s) => updatePerSession(s, projectPath, previousSid, () => ({
      cwd: opts?.wtPath ?? projectPath,
      _worktreePath: opts?.wtPath ?? null,
      _gitBranch: opts?.gitBranch ?? null,
    })))
    return
  }
  const nextProvider = previousSession?.sessionProvider ?? previousSession?.preferredProvider ?? 'claude'
  const newSid = createSessionId()
  set((s) => {
    const proj = getProject(s, projectPath)
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = opts?.wtPath ?? projectPath
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    newSession._worktreePath = opts?.wtPath ?? null
    newSession._gitBranch = opts?.gitBranch ?? null
    if (nextProvider === 'acp') {
      seedAcpSessionFromCache(s, newSession, previousSession)
    } else if (nextProvider !== 'codex') {
      // Claude (and default) only — must not clobber ACP selectedModel with a Claude id.
      // Remote: node catalog on project; local: desktop harness cache.
      const claudeModels = parseRemoteProjectKey(projectPath)
        ? (proj.claudeModels ?? [])
        : (s.harnessResources.claude?.models ?? [])
      applyDefaultModel(newSession, claudeModels)
    }
    // Every harness resolves its own mode now, Cursor's `agent` ladder included
    // — the carve-out this line used to need is gone.
    const switchedDefaults = sessionDefaultsFor(nextProvider)
    if (switchedDefaults.permissionMode) newSession.permissionMode = switchedDefaults.permissionMode
    const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
    newSession.selectedCodexModel = codexSelection.modelId
    newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    newSession.selectedCodexServiceTier = codexSelection.serviceTier
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
  // resolveNodeSessionId (no early create, no forced codex default).
  const isRemoteProject = !!parseRemoteProjectKey(activeProject)

  // Idempotent: a pristine current session (no messages, idle, not a live node
  // session, no worktree) is already "a fresh session". Creating another one
  // just stacks empty drafts in _sessions (duplicate "New session" in Ctrl+Tab).
  // A composer with unsent content is NOT pristine — the user wants a clean
  // session *and* their text kept, so fall through and park it as a draft.
  if (
    activeSession.messages.length === 0 &&
    !hasRealtimeTimeline &&
    !hasDraftContent(activeSession) &&
    !_isLiveSession(activeSession) &&
    !activeSession._worktreePath &&
    !isRemoteSession(get(), activeProject, currentSid)
  ) {
    window.app.trace?.('session.lifecycle', 'resetSession:skip-pristine', { activeProject, currentSid })
    return
  }

  // Persist the composer before it stops being the active session, so it shows
  // up in the sidebar's draft list instead of being stranded in _sessions.
  await promoteDraftIfUnsent(get(), activeProject, currentSid)

  const newSessionId = createSessionId()
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

  // Capture before set() — activeSession is the old Grok/ACP session we seed from.
  const previousAcpSession = nextProvider === 'acp' ? activeSession : null

  set((s) => {
    const proj = getProject(s, activeProject)
    const newSession = applyCachedCodexPermissionPreset(createDefaultPerSessionState())
    newSession.cwd = activeProject
    newSession.preferredProvider = nextProvider
    newSession.sessionProvider = nextProvider
    if (nextProvider === 'acp') {
      seedAcpSessionFromCache(s, newSession, previousAcpSession)
    } else if (nextProvider !== 'codex') {
      // Claude (and default) only — must not clobber ACP selectedModel with a Claude id.
      const claudeModels = isRemoteProject
        ? (proj.claudeModels ?? [])
        : (s.harnessResources.claude?.models ?? [])
      applyDefaultModel(newSession, claudeModels)
    }
    const codexSelection = resolveDefaultCodexSelection(proj.codexModels)
    newSession.selectedCodexModel = codexSelection.modelId
    newSession.selectedCodexReasoningEffort = codexSelection.reasoningEffort
    newSession.selectedCodexServiceTier = codexSelection.serviceTier
    const harnessDefaults = sessionDefaultsFor(nextProvider)
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
  // Fresh session starts with an empty activity view (no dock layout inherit).
  // See resetSessionForWorktreeSwitchImpl — shared terminal/browser panel ids
  // are not safe to fork across sessions.

  let unlock!: () => void
  resetLock.current = new Promise<void>((r) => { unlock = r })

  let agentConfig: { permissionMode: PermissionMode; sandboxInfo: SandboxInfo } | undefined
  try {
    if (isRemoteProject) {
      // No local SessionManager / no node session.create here.
      // First send materializes via resolveNodeSessionId.
    } else if (activeSession.sessionProvider === 'codex') {
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

export {
  setPreferredProviderImpl,
  setAcpAgentIdImpl,
  ensureAcpSlashCommandsImpl,
  hydrateAcpCatalogForSession,
} from './harness-selection'
