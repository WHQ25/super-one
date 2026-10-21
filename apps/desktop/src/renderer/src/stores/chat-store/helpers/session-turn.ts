/**
 * One way a user turn reaches its session's host, the same for this desktop
 * and a paired node: make the session real on the host, build the turn from
 * the session's selections, deliver it through `window.environment`.
 */
import { toast } from 'sonner'
import type { ChatMessage, ImageAttachment, SandboxMode, ScheduledSendRemoteTurn, WorktreeMode } from '@superone/shared/agent-types'
import type { SessionSendRequest, SessionSettingsPatch } from '@superone/shared/environment/session-requests'
import { sandboxModeFromInfo } from '@superone/shared/harness/harness-sandbox'
import { providerSessionIdFromResume } from '@superone/shared/environment'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { isDuplicateSend, withoutSendFailure, type FailedMessageResend } from '@superone/shared/send-failure'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
import { HARNESS_STRATEGIES } from '@/harness-ui/strategies'
import { hostPathForProjectKey, hostTakesDesktopChoices, removeSession } from '@/lib/session-client'
import { connectionIdForProjectKey } from '@/lib/session-list-ops'
import type { NodeSessionSnapshot } from '@/lib/remote-session-messages'
import type { ChatStore, PerSessionState } from '../types'
import { freshSubagentColorPool } from '../defaults'
import type { ChatStoreSet } from './lifecycle'
import { _getSessionCwd } from './persistence'
import { resolveProvider } from './provider-routing'
import { isUnsentSession, sessionDirectoryHint } from './session-liveness'
import { logWorktreeWrite } from '@superone/shared/session-worktree-log'
import { deliverUserSend, type UserSendDelivery } from './send-replay'
import type { SendWriteScope } from './send-write-scope'
import { getProject, getScopedPerSession, mergeCallerScopedDirs } from './store-helpers'
import { environmentIdForProjectKey } from '@superone/shared/session-location'
import type { SessionEnvironmentSelection } from '@superone/shared/session-location'

/**
 * Activate the worktree the composer has pending (branch, attach or detach)
 * before the turn that runs in it. False when it could not be activated; the
 * user has been told.
 */
function pendingCreateOf(
  owned: SessionEnvironmentSelection | null,
  mirror: {
    pendingBaseBranch: string | null
    pendingMode?: string
    pendingBranchName?: string
    pendingCarryLocalChanges?: boolean
  },
): { baseBranch: string; mode: WorktreeMode | string; branchName: string; carryLocalChanges: boolean } | null {
  if (owned?.selection.kind === 'local' || owned?.selection.kind === 'existing') return null
  if (owned?.selection.kind === 'create') return owned.selection
  if (!mirror.pendingBaseBranch) return null
  return {
    baseBranch: mirror.pendingBaseBranch,
    mode: mirror.pendingMode ?? 'branch',
    branchName: mirror.pendingBranchName ?? '',
    carryLocalChanges: !!mirror.pendingCarryLocalChanges,
  }
}

export async function applyPendingWorktree(projectPath: string, writeScope: SendWriteScope): Promise<boolean> {
  const { useAppStore } = await import('../../app')
  const { useChatStore } = await import('../index')
  const state = useChatStore.getState()
  const sessionId = writeScope.sessionId()
  const session = sessionId ? state.projectSessions[projectPath]?._sessions[sessionId] : undefined
  const owned = session?.environmentSelection ?? null
  // A session that already chose the project root must not pick up a pending
  // create left in the file-tree cache by the session that was focused before.
  if (owned?.selection.kind === 'local' || owned?.selection.kind === 'existing') return true
  const pending = pendingCreateOf(owned, useAppStore.getState().getWorktreeState(projectPath))
  if (!pending) return true
  const { baseBranch, mode } = pending
  const branchName = pending.branchName.trim()
  const fail = (message: string) => {
    toast.error(message)
    return false
  }
  if (mode === 'branch' && !branchName) return fail('Branch mode requires a branch name')
  const result = await window.app.activateWorktree(projectPath, {
    baseBranch,
    mode: mode as WorktreeMode,
    branchName: mode === 'branch' ? branchName : undefined,
    carryLocalChanges: pending.carryLocalChanges,
  })
  if (!result.ok) return fail(result.error || 'Failed to activate the worktree')
  logWorktreeWrite('applyPendingWorktree', {
    projectPath,
    sessionId,
    before: session?._worktreePath ?? null,
    after: result.path,
    unsent: isUnsentSession(session),
  })
  const branch = mode === 'branch' ? branchName : baseBranch
  useAppStore.getState().setActiveWorktree(projectPath, result.path)
  writeScope.patch(() => ({
    cwd: result.path,
    messages: [],
    totalCostUsd: 0,
    contextTokens: 0,
    session: null,
    sessionProvider: null,
    _gitBranch: branch,
    _worktreePath: result.path,
    environmentSelection: {
      environmentId: owned?.environmentId ?? environmentIdForProjectKey(projectPath),
      selection: { kind: 'existing', path: result.path, branch },
    },
    todos: {},
    _nextTodoId: 1,
    showTodos: false,
    _todosUserDismissed: false,
    subagentTokens: {},
    subagentColors: {},
    _subagentColorsFree: freshSubagentColorPool(),
  }))
  return true
}

/** The host's id of the project a key names: this desktop's folder id, or the node's. */
async function hostProjectId(projectKey: string): Promise<string> {
  const path = hostPathForProjectKey(projectKey).replace(/\/$/, '')
  const projects = await window.environment.listProjects(connectionIdForProjectKey(projectKey))
  const match = projects.find((project) => project.path.replace(/\/$/, '') === path)
  if (!match?.projectId) throw new Error('This project is not registered on its host. Open it again.')
  return match.projectId
}

/** A session's working folder as its host names it; undefined leaves the host's choice alone. */
function sessionHostCwd(session: PerSessionState): string | undefined {
  const hint = sessionDirectoryHint(session)
  return hint ? hostPathForProjectKey(hint) : undefined
}

/** The sandbox the session shows: its own, else its project's. Unknown, the host keeps its own. */
function sessionSandboxMode(state: ChatStore, projectPath: string, session: PerSessionState): SandboxMode | undefined {
  const info = session.sandboxInfo ?? getProject(state, projectPath).sandboxInfo
  return info ? sandboxModeFromInfo(info) : undefined
}

function sessionModel(state: ChatStore, projectPath: string, session: PerSessionState): { model?: string; effort?: string } {
  const runModel = HARNESS_STRATEGIES[resolveProvider(session)].runModel
  if (runModel) return runModel(session, getProject(state, projectPath))
  return { model: session.selectedModel || undefined, effort: session.selectedEffort || undefined }
}

/**
 * The settings a draft chose before its host had a session to hold them. A
 * node takes the portable ones; the harness-specific ones only this desktop's
 * host keeps (a node takes those with each turn instead).
 */
function draftSettings(state: ChatStore, projectPath: string, session: PerSessionState): SessionSettingsPatch {
  const { model, effort } = sessionModel(state, projectPath, session)
  const desktop = hostTakesDesktopChoices(projectPath)
  const sandboxMode = sessionSandboxMode(state, projectPath, session)
  const strategy = HARNESS_STRATEGIES[resolveProvider(session)]
  return {
    permissionMode: session.permissionMode,
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(session.apiProviderId ? { apiProviderId: session.apiProviderId } : {}),
    ...strategy.portableDraftSettings?.(session),
    ...(desktop ? strategy.draftSettings?.(session) : {}),
  }
}

/** The host continued `from` in `to`; a reload reads the same from the host. */
function markContinued(set: ChatStoreSet, projectPath: string, from: string, to: string): void {
  set((s) => {
    const project = getProject(s, projectPath)
    const old = project._sessions[from]
    if (!old) return {}
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: { ...project, _sessions: { ...project._sessions, [from]: { ...old, _continuedIn: to } } },
      },
    }
  })
}

/** Move the composer's draft entry to the id its host gave the session. */
function adoptSessionId(set: ChatStoreSet, projectPath: string, from: string | null, to: string): void {
  set((s) => {
    const project = getProject(s, projectPath)
    const sessions = { ...project._sessions }
    const base = (from ? sessions[from] : undefined) ?? sessions[to]
    if (from && from !== to) delete sessions[from]
    if (base) sessions[to] = base
    return {
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...project,
          _activeSessionId: !from || project._activeSessionId === from ? to : project._activeSessionId,
          _sessions: sessions,
        },
      },
    }
  })
  if (from && from !== to) {
    void import('@/components/mosaic/mosaic-store').then(({ useMosaicStore }) => {
      useMosaicStore.getState().replaceTileSession(projectPath, from, to)
    }).catch(() => {})
  }
}

/**
 * Make the composer's session real on its host and point `writeScope` at it.
 *
 * A session that has carried a turn exists there. An empty one is looked up:
 * missing, or on another harness than the composer picked, it is created with
 * the draft's settings, and an empty one it replaces is removed. This
 * desktop's host keeps the draft's id; a node names its own.
 */
export async function ensureHostSession(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  writeScope: SendWriteScope,
  options: { requireActivation?: boolean } = {},
): Promise<string> {
  const candidate = writeScope.sessionId()
  const session = getScopedPerSession(get(), candidate ? { projectPath, sessionId: candidate } : writeScope.target)
  const harness = resolveProvider(session)
  const connectionId = connectionIdForProjectKey(projectPath)
  let sid = candidate
  if (!candidate || session.messages.length === 0) {
    const record = candidate
      ? await window.environment.getSession(connectionId, candidate) as { harnessId?: string } | null
      : null
    // A continuation is always created: create is where it takes over the old session's channels.
    if (!record || record.harnessId !== harness || session.continuesFrom) {
      const desktop = hostTakesDesktopChoices(projectPath)
      // This desktop's host keeps the draft's id, so an empty session on
      // another harness (a prewarmed runtime) goes first.
      if (record && candidate && desktop) await removeSession(projectPath, candidate)
      const cwd = sessionHostCwd(session)
      const created = await window.environment.createSession(connectionId, {
        projectId: await hostProjectId(projectPath),
        harnessId: harness,
        settings: draftSettings(get(), projectPath, session),
        ...(cwd ? { cwd } : {}),
        ...(session.continuesFrom ? { continuesFrom: session.continuesFrom } : {}),
        ...(desktop ? { selections: {
          ...(candidate ? { sessionId: candidate } : {}),
          ...HARNESS_STRATEGIES[harness].createSelections?.(session),
        } } : {}),
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!/harness not ready/i.test(message)) throw error
        throw new Error(`The ${harness} harness is not ready where this session runs. Enable it there, or switch the chat to a ready harness. (${message})`)
      })
      sid = created.sessionId
      if (record && candidate && !desktop) void removeSession(projectPath, candidate).catch(() => {})
      if (session.continuesFrom) markContinued(set, projectPath, session.continuesFrom, sid)
    }
  }
  if (!sid) throw new Error('No session to send to')
  adoptSessionId(set, projectPath, candidate, sid)
  writeScope.target = { projectPath, sessionId: sid }
  writeScope.patch(() => ({ hostSessionOwned: true, sessionProvider: harness, preferredProvider: harness, _historyHydrated: true, continuesFrom: null }))
  // Keep window presence in sync; commands always retain their explicit session id.
  await window.agent.activateSession(projectPath, sid, _getSessionCwd(projectPath, getScopedPerSession(get(), writeScope.target))).catch((error: unknown) => {
    if (options.requireActivation) throw error
  })
  return sid
}

export interface SessionTurnOptions {
  text: string
  clientMessageId: string
  images?: ImageAttachment[]
  userMessageContent?: ChatMessage['content']
  contexts?: ChatMessage['contexts']
  userSelections?: string[]
  /** Run after the turn in progress (`priority: 'next'`). */
  queued?: boolean
  /** The session's first turn, which carries what a prewarmed runtime may not have taken yet. */
  firstTurn?: boolean
  inputRequest?: SessionSendRequest['inputRequest']
  turnKind?: SessionSendRequest['turnKind']
  reviewTarget?: unknown
}

/**
 * The turn a session sends: its text and the selections it runs with, read
 * from the composer's session. A node remembers only its own defaults, so
 * every turn names them; the desktop's own choices (queue, harness pickers)
 * go only to this desktop's host, which a node refuses. `choices` preserves the
 * composer's selections across activation replay; thread identity stays live.
 */
export function sessionTurnRequest(state: ChatStore, projectPath: string, sessionId: string, turn: SessionTurnOptions, choices?: PerSessionState): SessionSendRequest {
  const project = getProject(state, projectPath)
  const currentSession = getScopedPerSession(state, { projectPath, sessionId })
  const session = choices ?? currentSession
  const harness = resolveProvider(session)
  const desktop = hostTakesDesktopChoices(projectPath)
  const { model, effort } = sessionModel(state, projectPath, session)
  const sandboxMode = sessionSandboxMode(state, projectPath, session)
  const cwd = sessionHostCwd(session)
  const fields = HARNESS_STRATEGIES[harness].turnSettings?.({ state, project, session, current: currentSession, turn }) ?? {}
  return {
    sessionId,
    projectPath,
    providerId: harness,
    text: turn.text,
    clientMessageId: turn.clientMessageId,
    ...(cwd !== undefined ? { cwdHostPath: cwd } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(turn.firstTurn ? { permissionMode: session.permissionMode } : {}),
    ...(turn.firstTurn && sandboxMode ? { sandboxMode } : {}),
    additionalDirectories: mergeCallerScopedDirs(project, session),
    ...(session.apiProviderId ? { apiProviderId: session.apiProviderId } : {}),
    ...fields.portable,
    ...(turn.reviewTarget !== undefined ? { reviewTarget: turn.reviewTarget } : {}),
    ...(turn.images?.length ? { images: turn.images.map((image) => ({
      ...(image.id ? { id: image.id } : {}), name: image.name, mimeType: image.mimeType, base64: image.base64,
      ...(image.originalPath ? { originalPath: image.originalPath } : {}),
    })) } : {}),
    ...(turn.userMessageContent ? { userMessageContent: turn.userMessageContent } : {}),
    ...(turn.contexts ? { contexts: turn.contexts } : {}),
    ...(turn.userSelections?.length ? { userSelections: turn.userSelections } : {}),
    ...(turn.queued && (desktop || nativeQueue(currentSession)) ? { priority: 'next' as const } : {}),
    ...(desktop ? {
      ...(turn.inputRequest ? { inputRequest: turn.inputRequest } : {}),
      ...fields.desktop,
    } : {}),
  }
}

/** The turn options a node session's scheduled send carries; the desktop sends it later on its behalf. */
export function scheduledTurnOptions(state: ChatStore, projectPath: string, sessionId: string): ScheduledSendRemoteTurn {
  const { sessionId: _sid, projectPath: _key, text: _text, clientMessageId: _id, ...turn } = sessionTurnRequest(state, projectPath, sessionId, { text: '', clientMessageId: '' })
  return turn as ScheduledSendRemoteTurn
}

/** Whether a send to this session waits behind the turn it is running. */
function nativeQueue(session?: Pick<PerSessionState, 'runtimeCapabilities'>): boolean {
  return session?.runtimeCapabilities?.supportsQueuedSteer === true
}

export function queuesBehindTurn(projectPath: string, queued: boolean, session?: Pick<PerSessionState, 'runtimeCapabilities'>): boolean {
  return queued && (hostTakesDesktopChoices(projectPath) || nativeQueue(session))
}

/**
 * Hand one prepared turn to the session's host and apply the record it
 * answers with: its title, and the harness session id the sidebar copies.
 * This desktop's host titles its sessions by event; for a node the first
 * message names a session it has not titled.
 */
export async function deliverSessionTurn(
  set: ChatStoreSet,
  writeScope: SendWriteScope,
  turn: {
    projectPath: string
    request: SessionSendRequest & { clientMessageId: string }
    /** Plain text a missing session title is derived from. */
    titleText: string
  } & Pick<UserSendDelivery<unknown>, 'retryState' | 'failureState' | 'onRejected' | 'retryable' | 'onDelivered'>,
): Promise<void> {
  const { projectPath, request, titleText } = turn
  const sid = request.sessionId
  const applyRecord = (record: NodeSessionSnapshot | null) => {
    const hostTitle = typeof record?.title === 'string' && record.title.trim() ? record.title.trim() : null
    const titleSource = stripMiniAppMarkup(titleText).trim().replace(/\s+/g, ' ')
    const derived = titleSource && !hostTakesDesktopChoices(projectPath)
      ? (titleSource.length > SESSION_TITLE_MAX_CHARS ? `${titleSource.slice(0, SESSION_TITLE_MAX_CHARS)}…` : titleSource)
      : null
    const title = hostTitle || derived
    if (title) writeScope.patch(() => ({ _title: title }))
    const providerSessionId = (typeof record?.providerSessionId === 'string' && record.providerSessionId.trim()
      ? record.providerSessionId.trim()
      : null) ?? providerSessionIdFromResume(record?.providerResume)
    if (!title && !providerSessionId) return
    set((s) => {
      const project = s.projectSessions[projectPath]
      let changed = false
      const sessions = project?.sessions?.map((entry) => {
        if (entry.sessionId !== sid) return entry
        const next = {
          ...entry,
          ...(title ? { title } : {}),
          ...(providerSessionId ? { providerSessionId } : {}),
        }
        changed ||= next.title !== entry.title || next.providerSessionId !== entry.providerSessionId
        return next
      })
      return {
        ...(title && s.agentTitles[sid] !== title ? { agentTitles: { ...s.agentTitles, [sid]: title } } : {}),
        ...(project && sessions && changed ? { projectSessions: { ...s.projectSessions, [projectPath]: { ...project, sessions } } } : {}),
      }
    })
  }
  await deliverUserSend({
    messageId: request.clientMessageId,
    patchSession: writeScope.patch,
    deliver: () => window.environment.sendSessionMessage(connectionIdForProjectKey(projectPath), request),
    onDelivered: async (result) => {
      applyRecord(result as NodeSessionSnapshot | null)
      await turn.onDelivered?.(result)
    },
    retryState: turn.retryState,
    failureState: turn.failureState,
    onRejected: turn.onRejected,
    retryable: turn.retryable,
  })
}

/**
 * Resend a failed row from what its transcript kept, under the same id, the
 * way a composer send goes. The row came from the host, so its session exists.
 */
export async function resendSessionMessage(
  set: ChatStoreSet,
  get: () => ChatStore,
  projectPath: string,
  writeScope: SendWriteScope,
  resend: FailedMessageResend,
): Promise<void> {
  const sid = writeScope.sessionId()
  if (!sid) return
  writeScope.target = { projectPath, sessionId: sid }
  const session = getScopedPerSession(get(), writeScope.target)
  writeScope.patch((s) => ({
    messages: s.messages.map((m) => (m.id === resend.clientMessageId ? withoutSendFailure(m) : m)),
    awaitingAssistantReply: true,
  }))
  await deliverSessionTurn(set, writeScope, {
    projectPath,
    request: {
      ...sessionTurnRequest(get(), projectPath, sid, {
        text: resend.content,
        clientMessageId: resend.clientMessageId,
        images: resend.images,
        userMessageContent: resend.userMessageContent,
        contexts: resend.contexts,
      }),
      clientMessageId: resend.clientMessageId,
    },
    titleText: resend.content,
    // A stale Resend: the host already has this message and ran nothing new.
    onDelivered: (result) => {
      if (isDuplicateSend(result)) writeScope.patch(() => ({ awaitingAssistantReply: false }))
    },
    retryState: () => ({ awaitingAssistantReply: true }),
    failureState: () => ({ status: session.status === 'streaming' ? 'streaming' : 'idle' }),
  })
}
