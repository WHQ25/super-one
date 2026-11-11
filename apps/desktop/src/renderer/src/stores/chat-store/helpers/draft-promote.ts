/**
 * Promote / carry unsent composer text as a draft.
 *
 * A draft is content identity (text + chips + attachments + stable id) **plus**
 * the full new-session config (harness, model, effort, permission, sandbox,
 * worktree, branch, …). Project path is the soft "where to open" target; the
 * same draft id survives project switches via carry.
 */

import type { DraftUpsertRequest } from '@superone/shared/environment'
import { useAppStore } from '../../app'
import { useDraftsStore } from '../../drafts'
import type { ChatStore, PerSessionState, ProjectState } from '../types'
import { useChatStore } from '../index'
import { _isLiveSession, isUnsentSession } from './session-liveness'
import { logWorktreeWrite } from '@superone/shared/session-worktree-log'
import {
  applyDraftWorktreeUi,
  clearParkedDraftMap,
  computeCarriedDraftSessions,
  draftProjectKey,
  emptyDraftFields,
  getParkedDraft,
  hasDraftContent,
  hintFromSession,
  isDraftOwnedBySession,
  parkDraftSnapshot,
  projectSandboxFromSettings,
  releaseParkedDraft,
  resolveDraftTarget,
  sessionFieldsFromSettings,
  snapshotDraftSettings,
  type OpenDraftCarry,
  type ParkedDraftSnapshot,
  type WorktreeHint,
} from './draft-settings'

export {
  applyDraftWorktreeUi,
  computeCarriedDraftSessions,
  draftProjectKey,
  getParkedDraft,
  hasDraftContent,
  isDraftOwnedBySession,
  parkDraftSnapshot,
  projectSandboxFromSettings,
  releaseParkedDraft,
  resolveDraftTarget,
  sessionFieldsFromSettings,
  snapshotDraftSettings,
  type OpenDraftCarry,
  type ParkedDraftSnapshot,
  type WorktreeHint,
}

/**
 * Renderer session id → draft id. Keeps repeated switches away from the same
 * unsent session updating one draft instead of minting a new one each time.
 * The store's unique origin index is the durable backstop for when this map is
 * lost (reload, crash).
 */
const draftIdBySession = new Map<string, string>()

export { isUnsentSession } from './session-liveness'

export function getDraftIdForSession(sessionId: string): string | undefined {
  return draftIdBySession.get(sessionId)
}

function draftTrace(type: string, data: unknown, tag?: string): void {
  if (typeof window === 'undefined') return
  window.app?.trace?.('drafts', type, data, tag)
}

/**
 * Session id → worktree UI last seen while that session was focused.
 * Built from the session itself. The per-project cache follows whichever
 * session is focused, so reading it here would copy another session's checkout.
 */
const worktreeHintBySession = new Map<string, WorktreeHint | null>()

function readAppWorktree(projectPath: string): WorktreeHint | null {
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
}

function savedDraftWorktreeHint(projectPath: string, draftId: string | null | undefined): WorktreeHint | null {
  if (!draftId) return null
  const settings = useDraftsStore.getState().byConnection?.[resolveDraftTarget(projectPath).connectionId]
    ?.find((d) => d.id === draftId)?.settings
  if (!settings) return null
  return {
    path: settings.worktreePath ?? null,
    branch: settings.gitBranch ?? null,
    pendingBaseBranch: settings.pendingBaseBranch ?? null,
    pendingMode: settings.pendingWorktreeMode ?? null,
    pendingBranchName: settings.pendingBranchName ?? null,
    pendingCarryLocalChanges: !!settings.pendingCarryLocalChanges,
  }
}

function worktreeHintForSession(
  projectPath: string,
  sessionId: string,
  session: PerSessionState,
  project: ProjectState | undefined,
): WorktreeHint | null {
  if (project?._activeSessionId === sessionId) {
    const hint = useAppStore.getState().experimentalRemoteNodesEnabled
      ? hintFromSession(session)
      : readAppWorktree(projectPath)
    worktreeHintBySession.set(sessionId, hint)
    return hint
  }
  return worktreeHintBySession.get(sessionId)
    ?? savedDraftWorktreeHint(projectPath, draftIdBySession.get(sessionId) ?? session.draftId)
    ?? hintFromSession(session)
}

export function captureOpenDraft(
  store: ChatStore,
  projectPath: string,
  sessionId: string | null,
): OpenDraftCarry | null {
  if (!sessionId) return null
  const project = store.projectSessions[projectPath]
  const session = project?._sessions[sessionId]
  if (!isUnsentSession(session)) return null
  const existingDraftId = draftIdBySession.get(sessionId) ?? session.draftId ?? null
  const draftId = hasDraftContent(session)
    ? (existingDraftId ?? crypto.randomUUID())
    : existingDraftId
  if (draftId) draftIdBySession.set(sessionId, draftId)
  return {
    draftId,
    fromProject: projectPath,
    fromSessionId: sessionId,
    text: session.draftText,
    docJson: session.draftJson,
    attachments: session.attachments.map((a) => ({ ...a })),
    settings: snapshotDraftSettings(
      session,
      project,
      worktreeHintForSession(projectPath, sessionId, session, project),
    ),
  }
}

export function commitCarriedDraftMaps(carried: OpenDraftCarry, toSessionId: string): void {
  draftIdBySession.delete(carried.fromSessionId)
  worktreeHintBySession.delete(carried.fromSessionId)
  if (toSessionId && carried.draftId) {
    draftIdBySession.set(toSessionId, carried.draftId)
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
  set((s) => {
    const res = computeCarriedDraftSessions(s.projectSessions, toProject, carried)
    toSessionId = res.toSessionId
    return res.toSessionId ? { projectSessions: res.projectSessions } : {}
  })
  commitCarriedDraftMaps(carried, toSessionId)
  return toSessionId
}

export function buildUpsertFromSession(
  store: ChatStore,
  projectPath: string,
  sessionId: string,
  session: PerSessionState,
  project: ProjectState | undefined,
  worktree?: WorktreeHint | null,
): DraftUpsertRequest {
  const target = resolveDraftTarget(projectPath)
  const draftId = ensureDraftIdForSession(sessionId, session)
  const settings = snapshotDraftSettings(
    session,
    project,
    worktree === undefined ? worktreeHintForSession(projectPath, sessionId, session, project) : worktree,
  )
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
  if (session?.draftRemoteDeviceId) return
  const existingId = draftIdBySession.get(sessionId) ?? session?.draftId ?? null
  if (!isUnsentSession(session) || (!hasDraftContent(session) && !existingId)) {
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

  try {
    if (existingId && useDraftsStore.getState().isDraftDiscarded?.(existingId)) {
      draftTrace('promote_skip', { reason: 'discarded', projectPath, sessionId, draftId: existingId }, sessionId)
      return
    }
  } catch {
    /* drafts store unavailable in some unit tests */
  }

  const target = resolveDraftTarget(projectPath)
  const draft = buildUpsertFromSession(store, projectPath, sessionId, session, project)
  try {
    if (useDraftsStore.getState().isDraftDiscarded?.(draft.id)) {
      draftTrace('promote_skip', { reason: 'discarded', projectPath, sessionId, draftId: draft.id }, draft.id)
      return
    }
  } catch {
    /* drafts store mocked without this seam in some tests */
  }
  const parkedWorktree = draft.settings?.worktreePath ?? session._worktreePath
  logWorktreeWrite('promoteDraft.hydrate', {
    projectPath,
    sessionId,
    before: session._worktreePath,
    after: parkedWorktree ?? null,
    unsent: true,
  })
  if (hasDraftContent(session)) parkDraftSnapshot({
    draftId: draft.id,
    projectPath,
    sessionId,
    session: {
      ...session,
      _worktreePath: parkedWorktree,
      _gitBranch: draft.settings?.gitBranch ?? session._gitBranch,
    },
    sandboxInfo: project?.sandboxInfo ?? null,
  })
  else releaseParkedDraft(draft.id)
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
    await useDraftsStore.getState().closeLease?.(target.connectionId, draft.id)
    claimDraftForSession(sessionId, draft.id)
    // Stamp draftId on the live session so the pane stays in draft mode
    // and the sidebar can hide the row while the origin is still focused.
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
/** The environment draft row this unsent session autosaves into, minted on first use. */
export function ensureDraftIdForSession(sessionId: string, session: PerSessionState): string {
  const draftId = draftIdBySession.get(sessionId) ?? session.draftId ?? crypto.randomUUID()
  draftIdBySession.set(sessionId, draftId)
  return draftId
}

export function claimDraftForSession(sessionId: string, draftId: string): void {
  draftIdBySession.set(sessionId, draftId)
}

/**
 * A node names its own session id. The composer's draft was saved under the
 * renderer id, and the sidebar hides that row only while this map or
 * `session.draftId` still points at it. Move the link before the store commit
 * that adopts the new id, or the row is listed for the frames until send
 * consumes it.
 */
export function rekeyDraftForSession(fromSessionId: string, toSessionId: string, projectPath?: string): string | undefined {
  if (!fromSessionId || fromSessionId === toSessionId) return draftIdBySession.get(toSessionId)
  let draftId = draftIdBySession.get(fromSessionId)
  if (!draftId && projectPath) {
    try {
      const { connectionId } = resolveDraftTarget(projectPath)
      draftId = useDraftsStore.getState().byConnection?.[connectionId]
        ?.find((row) => row.originSessionId === fromSessionId)?.id
    } catch {
      /* drafts store unavailable in some unit tests */
    }
  }
  if (!draftId) return undefined
  draftIdBySession.delete(fromSessionId)
  draftIdBySession.set(toSessionId, draftId)
  return draftId
}

/**
 * User deleted this draft from the sidebar. Drop the parked origin so a later
 * visibility flush / session switch cannot upsert the same id back into the list.
 */
export function discardDeletedDraft(draftId: string, store?: ChatStore): void {
  try {
    useDraftsStore.getState().markDraftDiscarded?.(draftId)
  } catch {
    /* drafts store mocked without this seam in some tests */
  }

  let sessionId: string | undefined
  const parked = getParkedDraft(draftId)
  if (parked) sessionId = parked.sessionId
  if (!sessionId) {
    for (const [sid, id] of draftIdBySession) {
      if (id === draftId) {
        sessionId = sid
        break
      }
    }
  }
  if (sessionId) {
    draftIdBySession.delete(sessionId)
    worktreeHintBySession.delete(sessionId)
  }
  releaseParkedDraft(draftId)

  const apply = (s: ChatStore): Partial<ChatStore> => {
    if (!sessionId) return {}
    let changed = false
    const next = { ...s.projectSessions }
    for (const [path, project] of Object.entries(next)) {
      const sess = project._sessions[sessionId]
      if (!sess) continue
      changed = true
      if (project._activeSessionId === sessionId) {
        next[path] = {
          ...project,
          _sessions: {
            ...project._sessions,
            [sessionId]: { ...sess, ...emptyDraftFields() },
          },
        }
      } else {
        const { [sessionId]: _removed, ...rest } = project._sessions
        next[path] = { ...project, _sessions: rest }
      }
    }
    return changed ? { projectSessions: next } : {}
  }

  if (store) {
    const patch = apply(store)
    if (patch.projectSessions) store.projectSessions = patch.projectSessions
    return
  }
  useChatStore.setState((s) => apply(s))
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
  worktreeHintBySession.delete(sessionId)
  if (!draftId) return
  draftIdBySession.delete(sessionId)
  releaseParkedDraft(draftId)
  const { connectionId } = resolveDraftTarget(projectPath)
  const drafts = useDraftsStore.getState()
  // Carry preserves content identity across execution environments. Each host
  // may still hold an autosaved copy, so consuming only the sending host leaves
  // the old node's draft available to resume and send again.
  const connections = new Set([connectionId])
  for (const [id, rows] of Object.entries(drafts.byConnection ?? {})) {
    if (rows.some((row) => row.id === draftId)) connections.add(id)
  }
  // A save already in flight on any host must not recreate the consumed draft.
  drafts.markDraftDiscarded(draftId)
  await Promise.allSettled([...connections].map((id) => drafts.removeDraft(id, draftId)))
}

/** Test seam — the module-level map would otherwise leak across cases. */
export function _resetDraftSessionMap(): void {
  draftIdBySession.clear()
  clearParkedDraftMap()
  worktreeHintBySession.clear()
}
