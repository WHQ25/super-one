/**
 * Promote / carry unsent composer text as a draft.
 *
 * A draft is content identity (text + chips + attachments + stable id) **plus**
 * the full new-session config (harness, model, effort, permission, sandbox,
 * worktree, branch, …). Project path is the soft "where to open" target; the
 * same draft id survives project switches via carry.
 */

import { remoteProjectKey, parseRemoteProjectKey } from '@/lib/remote-project-key'
import type {
  DraftSessionSettings,
  DraftUpsertRequest,
} from '@superone/shared/environment'
import type {
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  EffortLevel,
  ImageAttachment,
  PermissionMode,
} from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/session-types'
import { useDraftsStore } from '../../drafts'
import type { ChatProvider, ChatStore, PerSessionState, ProjectState } from '../types'
import { _isLiveSession } from './session-liveness'

/**
 * Renderer session id → draft id. Keeps repeated switches away from the same
 * unsent session updating one draft instead of minting a new one each time.
 * The store's unique origin index is the durable backstop for when this map is
 * lost (reload, crash).
 */
const draftIdBySession = new Map<string, string>()

/** True when the session has no conversation on any host yet. */
export function isUnsentSession(session: PerSessionState | undefined): boolean {
  return !!session && session.messages.length === 0 && !_isLiveSession(session)
}

/**
 * Which environment owns this project, and the host-side path to record.
 * A remote project key carries both; a local path is its own project path.
 */
export function resolveDraftTarget(projectPath: string): {
  connectionId: string
  projectPath: string
} {
  const remote = parseRemoteProjectKey(projectPath)
  return remote
    ? { connectionId: remote.connectionId, projectPath: remote.path }
    : { connectionId: 'local', projectPath }
}

/** Rebuild the renderer project key a draft points at. */
export function draftProjectKey(connectionId: string, projectPath: string | null): string | null {
  if (!projectPath) return null
  return connectionId === 'local' ? projectPath : remoteProjectKey(connectionId, projectPath)
}

export function getDraftIdForSession(sessionId: string): string | undefined {
  return draftIdBySession.get(sessionId)
}

function draftTrace(type: string, data: unknown, tag?: string): void {
  if (typeof window === 'undefined') return
  window.app?.trace?.('drafts', type, data, tag)
}

/**
 * Full in-memory snapshot of a parked unsent session. Resume must restore
 * THIS object rather than minting a default session and hoping the persisted
 * row still has settings — switchSession/hydrate would otherwise paint catalog
 * defaults and only the text would look restored.
 */
export interface ParkedDraftSnapshot {
  draftId: string
  projectPath: string
  sessionId: string
  session: PerSessionState
  sandboxInfo: ProjectState['sandboxInfo'] | null
}

const parkedByDraftId = new Map<string, ParkedDraftSnapshot>()

function cloneSession(session: PerSessionState): PerSessionState {
  return {
    ...session,
    attachments: session.attachments.map((a) => ({ ...a })),
    additionalDirs: [...(session.additionalDirs ?? [])],
    messages: [],
  }
}

export function getParkedDraft(draftId: string): ParkedDraftSnapshot | undefined {
  return parkedByDraftId.get(draftId)
}

export function parkDraftSnapshot(snapshot: ParkedDraftSnapshot): void {
  parkedByDraftId.set(snapshot.draftId, {
    ...snapshot,
    session: cloneSession(snapshot.session),
  })
}

export function releaseParkedDraft(draftId: string): void {
  parkedByDraftId.delete(draftId)
}

export interface WorktreeHint {
  path: string | null
  /** Optional branch label from the worktree UI when session has not been updated yet. */
  branch?: string | null
  pendingBaseBranch?: string | null
  pendingMode?: string | null
  pendingBranchName?: string | null
  pendingCarryLocalChanges?: boolean
}

/**
 * Snapshot everything the new-session UI holds for park/resume.
 * Worktree may live on the app store before it is mirrored onto the session —
 * pass `worktree` so we do not drop it.
 */
export function snapshotDraftSettings(
  session: PerSessionState,
  project?: ProjectState | null,
  worktree?: WorktreeHint | null,
): DraftSessionSettings {
  const harness = (session.sessionProvider ?? session.preferredProvider) as HarnessId
  const model = session.selectedModel || null
  const effort = session.selectedEffort ?? null
  const codexModel = session.selectedCodexModel || null
  const codexEffort = session.selectedCodexReasoningEffort ?? null
  const worktreePath = session._worktreePath ?? worktree?.path ?? null
  const gitBranch = session._gitBranch ?? worktree?.branch ?? null

  return {
    harness,
    model,
    effort,
    // Force "user chosen" whenever a value is present so restore cannot be
    // clobbered by applyDefaultModel / _reapplyAgentDefaultsToSessions.
    modelUserChosen: session.modelUserChosen || !!model,
    effortUserChosen: session.effortUserChosen || !!effort,
    codexModel,
    codexReasoningEffort: codexEffort,
    codexModelUserChosen: session.codexModelUserChosen || !!codexModel,
    codexReasoningEffortUserChosen: session.codexReasoningEffortUserChosen || !!codexEffort,
    codexPermissionPreset: session.selectedCodexPermissionPreset,
    codexCollaborationMode: session.selectedCodexCollaborationMode,
    permissionMode: session.permissionMode,
    acpAgentId: session.acpAgentId,
    openCodeAgentId: session.openCodeAgentId,
    selectedAcpModeId: session.selectedAcpModeId,
    apiProviderId: session.apiProviderId,
    worktreePath,
    gitBranch,
    pendingBaseBranch: worktree?.pendingBaseBranch ?? null,
    pendingWorktreeMode: worktree?.pendingMode ?? null,
    pendingBranchName: worktree?.pendingBranchName ?? null,
    pendingCarryLocalChanges: worktree?.pendingCarryLocalChanges ?? false,
    sandboxEnabled: project?.sandboxInfo?.enabled,
    sandboxAutoAllowBash: project?.sandboxInfo?.autoAllowBash,
    additionalDirs: session.additionalDirs?.length ? [...session.additionalDirs] : [],
  }
}

/** Apply saved new-session config onto a session row (content applied separately). */
export function sessionFieldsFromSettings(
  settings: DraftSessionSettings | null | undefined,
): Partial<PerSessionState> {
  if (!settings) return {}
  const patch: Partial<PerSessionState> = {}
  if (settings.harness) {
    patch.preferredProvider = settings.harness as ChatProvider
    patch.sessionProvider = settings.harness as ChatProvider
  }
  if (settings.model != null && settings.model !== '') {
    patch.selectedModel = settings.model
    patch.modelUserChosen = true
  }
  if (settings.effort != null && settings.effort !== '') {
    patch.selectedEffort = settings.effort as EffortLevel
    patch.effortUserChosen = true
  }
  if (settings.codexModel != null && settings.codexModel !== '') {
    patch.selectedCodexModel = settings.codexModel
    patch.codexModelUserChosen = true
  }
  if (settings.codexReasoningEffort != null && settings.codexReasoningEffort !== '') {
    patch.selectedCodexReasoningEffort = settings.codexReasoningEffort as CodexReasoningEffort
    patch.codexReasoningEffortUserChosen = true
  }
  if (settings.codexPermissionPreset) {
    patch.selectedCodexPermissionPreset = settings.codexPermissionPreset as CodexPermissionPreset
  }
  if (settings.codexCollaborationMode) {
    patch.selectedCodexCollaborationMode =
      settings.codexCollaborationMode as CodexCollaborationMode
  }
  if (settings.permissionMode) {
    patch.permissionMode = settings.permissionMode as PermissionMode
  }
  if (settings.acpAgentId !== undefined) patch.acpAgentId = settings.acpAgentId
  if (settings.openCodeAgentId !== undefined) patch.openCodeAgentId = settings.openCodeAgentId
  if (settings.selectedAcpModeId !== undefined) {
    patch.selectedAcpModeId = settings.selectedAcpModeId
  }
  if (settings.apiProviderId !== undefined) patch.apiProviderId = settings.apiProviderId
  if (settings.worktreePath !== undefined) patch._worktreePath = settings.worktreePath
  if (settings.gitBranch !== undefined) patch._gitBranch = settings.gitBranch
  if (settings.additionalDirs) {
    patch.additionalDirs = [...settings.additionalDirs]
    patch.additionalDirsDirty = settings.additionalDirs.length > 0
  }
  return patch
}

/** Push saved worktree + pending-create UI onto the app store for this project. */
export function applyDraftWorktreeUi(
  projectPath: string,
  settings: DraftSessionSettings | null | undefined,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../app') as typeof import('../../app')
    useAppStore.setState({
      _worktrees: {
        ...useAppStore.getState()._worktrees,
        [projectPath]: {
          pendingBaseBranch: settings?.pendingBaseBranch ?? null,
          pendingMode: (settings?.pendingWorktreeMode as 'branch' | 'attach' | 'detach' | undefined) ?? 'branch',
          pendingBranchName: settings?.pendingBranchName ?? '',
          pendingCarryLocalChanges: !!settings?.pendingCarryLocalChanges,
          activePath: settings?.worktreePath ?? null,
        },
      },
    })
  } catch {
    /* app store unavailable in unit tests */
  }
}

export function projectSandboxFromSettings(
  settings: DraftSessionSettings | null | undefined,
): ProjectState['sandboxInfo'] | null {
  if (!settings || settings.sandboxEnabled === undefined) return null
  return {
    enabled: !!settings.sandboxEnabled,
    autoAllowBash: !!settings.sandboxAutoAllowBash,
  }
}

/** Snapshot of an open unsent draft, moved across project focus without re-id. */
export interface OpenDraftCarry {
  draftId: string
  fromProject: string
  fromSessionId: string
  text: string
  docJson: object | null
  attachments: ImageAttachment[]
  settings: DraftSessionSettings
}

function readAppWorktree(projectPath: string): WorktreeHint | null {
  try {
    // Lazy import avoids chat-store ↔ app cycle at module init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../app') as typeof import('../../app')
    const wt = useAppStore.getState()._worktrees[projectPath]
    if (!wt) return null
    return {
      path: wt.activePath,
      branch: null,
      pendingBaseBranch: wt.pendingBaseBranch,
      pendingMode: wt.pendingMode,
      pendingBranchName: wt.pendingBranchName,
      pendingCarryLocalChanges: wt.pendingCarryLocalChanges,
    }
  } catch {
    return null
  }
}

/**
 * If the outgoing session is an open unsent draft with text, capture it so the
 * caller can re-apply it on the destination project instead of parking it.
 */
export function captureOpenDraft(
  store: ChatStore,
  projectPath: string,
  sessionId: string | null,
): OpenDraftCarry | null {
  if (!sessionId) return null
  const project = store.projectSessions[projectPath]
  const session = project?._sessions[sessionId]
  if (!isUnsentSession(session) || !session.draftText.trim()) return null
  const draftId = draftIdBySession.get(sessionId) ?? crypto.randomUUID()
  draftIdBySession.set(sessionId, draftId)
  return {
    draftId,
    fromProject: projectPath,
    fromSessionId: sessionId,
    text: session.draftText,
    docJson: session.draftJson,
    attachments: session.attachments.map((a) => ({ ...a })),
    settings: snapshotDraftSettings(session, project, readAppWorktree(projectPath)),
  }
}

function emptyDraftFields(): Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments' | 'draftId'> {
  return { draftText: '', draftJson: null, attachments: [], draftId: null }
}

function contentAndSettingsFields(
  carried: OpenDraftCarry,
  /** When carrying onto another project, drop project-scoped worktree paths. */
  crossProject: boolean,
): Partial<PerSessionState> {
  const settings = crossProject
    ? { ...carried.settings, worktreePath: null, gitBranch: carried.settings.gitBranch ?? null }
    : carried.settings
  return {
    draftText: carried.text,
    draftJson: carried.docJson,
    attachments: carried.attachments,
    draftId: carried.draftId,
    ...sessionFieldsFromSettings(settings),
  }
}

/**
 * Move a captured open draft onto `toProject`. Reuses the destination's unsent
 * active session when possible; otherwise mints one. Clears the source
 * composer so a later promote cannot fork a second draft. Restores harness /
 * model / permission / … so the draft looks the same on arrival.
 */
export function applyCarriedDraft(
  set: (
    partial: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>),
  ) => void,
  toProject: string,
  carried: OpenDraftCarry,
): string {
  let toSessionId = ''
  const crossProject = carried.fromProject !== toProject
  // Worktree paths are project-scoped; do not transplant them across projects.
  const settingsForDest = crossProject
    ? { ...carried.settings, worktreePath: null }
    : carried.settings
  const sandbox = projectSandboxFromSettings(settingsForDest)

  set((s) => {
    const fromProj = s.projectSessions[carried.fromProject]
    const toProj = s.projectSessions[toProject]
    if (!toProj) return {}

    const nextSessions = { ...s.projectSessions }

    if (fromProj?._sessions[carried.fromSessionId]) {
      const src = fromProj._sessions[carried.fromSessionId]!
      nextSessions[carried.fromProject] = {
        ...fromProj,
        _sessions: {
          ...fromProj._sessions,
          [carried.fromSessionId]: { ...src, ...emptyDraftFields() },
        },
      }
    }

    const dest = nextSessions[toProject] ?? toProj
    const activeSid = dest._activeSessionId
    const active = activeSid ? dest._sessions[activeSid] : undefined
    const fields = contentAndSettingsFields(
      { ...carried, settings: settingsForDest },
      crossProject,
    )
    const destWithSandbox = sandbox
      ? { ...dest, sandboxInfo: sandbox }
      : dest

    if (activeSid && isUnsentSession(active)) {
      toSessionId = activeSid
      nextSessions[toProject] = {
        ...destWithSandbox,
        _sessions: {
          ...dest._sessions,
          [activeSid]: { ...active!, ...fields },
        },
      }
    } else {
      const newSid = crypto.randomUUID()
      toSessionId = newSid
      const template = active ?? Object.values(dest._sessions)[0]
      const base = template
        ? {
            ...template,
            messages: [],
            status: 'idle' as const,
            awaitingAssistantReply: false,
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            session: null,
            ...emptyDraftFields(),
            cwd: toProject,
          }
        : ({
            cwd: toProject,
            messages: [],
            status: 'idle',
            awaitingAssistantReply: false,
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            ...emptyDraftFields(),
          } as unknown as PerSessionState)
      nextSessions[toProject] = {
        ...destWithSandbox,
        _activeSessionId: newSid,
        _sessions: {
          ...dest._sessions,
          [newSid]: { ...base, ...fields },
        },
      }
    }

    return { projectSessions: nextSessions }
  })

  draftIdBySession.delete(carried.fromSessionId)
  if (toSessionId) draftIdBySession.set(toSessionId, carried.draftId)
  return toSessionId
}

function buildUpsertFromSession(
  store: ChatStore,
  projectPath: string,
  sessionId: string,
  session: PerSessionState,
  project: ProjectState | undefined,
): DraftUpsertRequest {
  const target = resolveDraftTarget(projectPath)
  const draftId = draftIdBySession.get(sessionId) ?? crypto.randomUUID()
  draftIdBySession.set(sessionId, draftId)
  const settings = snapshotDraftSettings(session, project, readAppWorktree(projectPath))
  return {
    id: draftId,
    text: session.draftText,
    docJson: session.draftJson,
    attachments: session.attachments.map((a) => ({
      name: a.name,
      mimeType: a.mimeType,
      data: a.base64,
      ...(a.id ? { id: a.id } : {}),
    })),
    projectPath: target.projectPath,
    harness: settings.harness ?? null,
    model:
      settings.harness === 'codex'
        ? (settings.codexModel ?? settings.model ?? null)
        : (settings.model ?? null),
    permissionMode: settings.permissionMode ?? null,
    settings,
    originSessionId: sessionId,
  }
}

/**
 * Save the outgoing session's composer + full new-session config as a draft.
 * Used when leaving the draft entirely (switch to a real conversation, quit).
 */
export async function promoteDraftIfUnsent(
  store: ChatStore,
  projectPath: string,
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) {
    draftTrace('promote_skip', { reason: 'no-sessionId', projectPath })
    return
  }
  const project = store.projectSessions[projectPath]
  const session = project?._sessions[sessionId]
  if (!isUnsentSession(session) || !session.draftText.trim()) {
    draftTrace('promote_skip', {
      reason: 'not-unsent-with-text',
      projectPath,
      sessionId,
      exists: !!session,
      messages: session?.messages.length,
      live: session ? _isLiveSession(session) : null,
      textLen: session?.draftText?.length ?? 0,
      sessionProvider: session?.sessionProvider,
      preferredProvider: session?.preferredProvider,
      selectedModel: session?.selectedModel,
    }, sessionId)
    return
  }

  const target = resolveDraftTarget(projectPath)
  const draft = buildUpsertFromSession(store, projectPath, sessionId, session, project)
  parkDraftSnapshot({
    draftId: draft.id,
    projectPath,
    sessionId,
    session: {
      ...session,
      _worktreePath: draft.settings?.worktreePath ?? session._worktreePath,
      _gitBranch: draft.settings?.gitBranch ?? session._gitBranch,
    },
    sandboxInfo: project?.sandboxInfo ?? null,
  })
  draftTrace('promote', {
    connectionId: target.connectionId,
    draftId: draft.id,
    projectPath,
    sessionId,
    harness: draft.harness,
    model: draft.model,
    permissionMode: draft.permissionMode,
    settings: draft.settings,
    sessionProvider: session.sessionProvider,
    preferredProvider: session.preferredProvider,
    selectedModel: session.selectedModel,
    selectedEffort: session.selectedEffort,
    selectedCodexModel: session.selectedCodexModel,
    parked: !!getParkedDraft(draft.id),
  }, draft.id)

  try {
    await useDraftsStore.getState().saveDraft(target.connectionId, draft)
    claimDraftForSession(sessionId, draft.id)
    // Stamp draftId on the live session so the pane stays on DraftSessionSurface
    // and the sidebar can hide the row while the origin is still focused.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useChatStore } = require('../index') as typeof import('../index')
      useChatStore.setState((s) => {
        const proj = s.projectSessions[projectPath]
        const sess = proj?._sessions[sessionId]
        if (!proj || !sess) return {}
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectPath]: {
              ...proj,
              _sessions: {
                ...proj._sessions,
                [sessionId]: { ...sess, draftId: draft.id },
              },
            },
          },
        }
      })
    } catch {
      /* chat store unavailable in unit tests */
    }
    draftTrace('promote_saved', { draftId: draft.id }, draft.id)
  } catch (err) {
    draftTrace('promote_failed', { draftId: draft.id, err: err instanceof Error ? err.message : String(err) }, draft.id)
  }
}

/**
 * Flush every unsent composer that still has text — used on app quit / window
 * hide so a draft the user never navigated away from is not lost.
 */
export async function promoteAllUnsentDrafts(store: ChatStore): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const [projectPath, project] of Object.entries(store.projectSessions)) {
    for (const sessionId of Object.keys(project._sessions)) {
      jobs.push(promoteDraftIfUnsent(store, projectPath, sessionId))
    }
  }
  await Promise.all(jobs)
}

/**
 * Hand a draft over to a freshly minted session. Called after the draft's text
 * has been loaded into the composer, so the drafts group stops showing it.
 */
export function claimDraftForSession(sessionId: string, draftId: string): void {
  draftIdBySession.set(sessionId, draftId)
}

/**
 * True when this draft is the open origin of the active empty session.
 * Sidebar must hide those rows — visibility/quit flush still persists them,
 * but replaying the snapshot over live keystrokes would clobber newer text.
 */
export function isDraftOwnedBySession(
  draft: { id: string; originSessionId: string | null },
  sessionId: string | null | undefined,
  sessionDraftId?: string | null,
): boolean {
  if (!sessionId) return false
  if (sessionDraftId && sessionDraftId === draft.id) return true
  return !!draft.originSessionId && draft.originSessionId === sessionId
}

/**
 * Drop the environment draft bound to this session (first send / session gone).
 * Best-effort: a missing mapping is a no-op.
 */
export async function consumeDraftForSession(
  projectPath: string,
  sessionId: string,
): Promise<void> {
  const draftId = draftIdBySession.get(sessionId)
  if (!draftId) return
  draftIdBySession.delete(sessionId)
  const { connectionId } = resolveDraftTarget(projectPath)
  try {
    await useDraftsStore.getState().removeDraft(connectionId, draftId)
  } catch {
    /* list will refresh; never block send */
  }
}

/** Test seam — the module-level map would otherwise leak across cases. */
export function _resetDraftSessionMap(): void {
  draftIdBySession.clear()
  parkedByDraftId.clear()
}
