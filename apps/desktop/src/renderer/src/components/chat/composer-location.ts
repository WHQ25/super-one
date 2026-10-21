import { useAppStore } from '@/stores/app'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { updatePerSession } from '@/stores/chat-store/helpers/store-helpers'
import type { PerSessionState } from '@/stores/chat-store/types'
import type { WorktreeMode } from '@superone/shared/agent-types'
import {
  environmentIdForProjectKey,
  selectionForNewSession,
  type NewSessionWorktreeSelection,
  type SessionEnvironmentSelection,
} from '@superone/shared/session-location'

/** File-tree cache. Read only when the session has not recorded a selection. */
export interface WorktreeMirror {
  pendingBaseBranch: string | null
  pendingMode: WorktreeMode
  pendingBranchName: string
  pendingCarryLocalChanges: boolean
  activePath: string | null
}

export interface ComposerLocation {
  environmentId: string
  cwd: string | null
  branch: string | null
  selection: NewSessionWorktreeSelection
  readOnly: boolean
  pendingCreate: boolean
}

type LocationSession = {
  environmentSelection?: SessionEnvironmentSelection | null
  _worktreePath?: string | null
  _gitBranch?: string | null
  session?: unknown
  messages?: { length: number }
} | null

/** One reading of where the composer runs, shared by the workdir and branch chips. */
export function composerLocationOf(input: {
  projectPath: string | null
  session: LocationSession
  mirror?: WorktreeMirror | null
}): ComposerLocation {
  const { projectPath, session, mirror } = input
  const fallbackEnvironment = environmentIdForProjectKey(projectPath)
  const readOnly = !!session && (session.session != null || (session.messages?.length ?? 0) > 0)
  const owned = session?.environmentSelection ?? null

  if (owned?.selection.kind === 'create') {
    return {
      environmentId: owned.environmentId,
      cwd: projectPath,
      branch: null,
      selection: owned.selection,
      readOnly,
      pendingCreate: true,
    }
  }
  if (owned?.selection.kind === 'existing') {
    return {
      environmentId: owned.environmentId,
      cwd: owned.selection.path,
      branch: owned.selection.branch ?? session?._gitBranch ?? null,
      selection: owned.selection,
      readOnly,
      pendingCreate: false,
    }
  }
  if (owned?.selection.kind === 'local') {
    return {
      environmentId: owned.environmentId,
      cwd: projectPath,
      branch: session?._gitBranch ?? null,
      selection: owned.selection,
      readOnly,
      pendingCreate: false,
    }
  }

  if (mirror?.pendingBaseBranch) {
    return {
      environmentId: fallbackEnvironment,
      cwd: projectPath,
      branch: null,
      selection: {
        kind: 'create',
        baseBranch: mirror.pendingBaseBranch,
        mode: mirror.pendingMode,
        branchName: mirror.pendingBranchName,
        carryLocalChanges: mirror.pendingCarryLocalChanges,
      },
      readOnly,
      pendingCreate: true,
    }
  }
  const path = session?._worktreePath ?? mirror?.activePath ?? null
  if (path) {
    return {
      environmentId: fallbackEnvironment,
      cwd: path,
      branch: session?._gitBranch ?? null,
      selection: { kind: 'existing', path, ...(session?._gitBranch ? { branch: session._gitBranch } : {}) },
      readOnly,
      pendingCreate: false,
    }
  }
  return {
    environmentId: fallbackEnvironment,
    cwd: projectPath,
    branch: session?._gitBranch ?? null,
    selection: { kind: 'local' },
    readOnly,
    pendingCreate: false,
  }
}

export function useComposerLocation(): ComposerLocation {
  const projectPath = useAppStore((s) => s.currentFolder)
  const mirror = useAppStore((s) => (projectPath ? s._worktrees[projectPath] : undefined))
  const environmentSelection = useActiveSession((s) => s.environmentSelection ?? null)
  const worktreePath = useActiveSession((s) => s._worktreePath)
  const gitBranch = useActiveSession((s) => s._gitBranch)
  const sdkSession = useActiveSession((s) => s.session)
  const messageCount = useActiveSession((s) => s.messages.length)
  return composerLocationOf({
    projectPath,
    session: {
      environmentSelection,
      _worktreePath: worktreePath,
      _gitBranch: gitBranch,
      session: sdkSession,
      messages: { length: messageCount },
    },
    mirror,
  })
}

/** Record the focused session's checkout. Call beside the file-tree cache write. */
export function writeFocusedSelection(
  projectPath: string,
  next: SessionEnvironmentSelection,
  paths?: { cwd?: string; worktreePath?: string | null; gitBranch?: string | null },
): void {
  useChatStore.setState((state) => {
    const project = state.projectSessions[projectPath]
    const sessionId = project?._activeSessionId
    if (!project || !sessionId || !project._sessions[sessionId]) return {}
    return updatePerSession(state, projectPath, sessionId, () => ({
      environmentSelection: next,
      ...(paths?.cwd !== undefined ? { cwd: paths.cwd } : {}),
      ...(paths?.worktreePath !== undefined ? { _worktreePath: paths.worktreePath } : {}),
      ...(paths?.gitBranch !== undefined ? { _gitBranch: paths.gitBranch } : {}),
    }))
  })
}

type CreateSelection = Extract<NewSessionWorktreeSelection, { kind: 'create' }>

/** Update the focused session's pending worktree from the user's latest edit. */
export function patchFocusedCreate(
  projectPath: string,
  patch: Partial<Pick<CreateSelection, 'baseBranch' | 'mode' | 'branchName' | 'carryLocalChanges'>>,
): void {
  const state = useChatStore.getState()
  const project = state.projectSessions[projectPath]
  const sessionId = project?._activeSessionId
  const session = sessionId ? project?._sessions[sessionId] : undefined
  const environmentId = session?.environmentSelection?.environmentId ?? environmentIdForProjectKey(projectPath)
  const previous = session?.environmentSelection?.selection.kind === 'create'
    ? session.environmentSelection.selection
    : null
  writeFocusedSelection(projectPath, {
    environmentId,
    selection: {
      kind: 'create',
      baseBranch: patch.baseBranch ?? previous?.baseBranch ?? '',
      mode: patch.mode ?? previous?.mode ?? 'branch',
      branchName: patch.branchName ?? previous?.branchName ?? '',
      carryLocalChanges: patch.carryLocalChanges ?? previous?.carryLocalChanges ?? false,
    },
  })
}

function unsentSession(session: PerSessionState | undefined): boolean {
  return !!session && session.messages.length === 0 && session.session == null
}

/**
 * Move the unsent composer onto another environment's checkout of this repo.
 * A started session on the destination is parked and a new root session takes over.
 */
export async function switchComposerToCheckout(checkout: {
  pathKey: string
  connectionId: string
  projectId: string
  environmentId: string
}): Promise<void> {
  const before = useChatStore.getState().activeProject
  await useAppStore.getState().selectProject(checkout.pathKey, {
    connectionId: checkout.connectionId,
    projectId: checkout.projectId,
    carryOpenDraft: true,
  })
  const after = useChatStore.getState().activeProject
  if (after !== checkout.pathKey && after === before && checkout.pathKey !== before) return
  const path = useChatStore.getState().activeProject
  if (!path) return
  const project = useChatStore.getState().projectSessions[path]
  const sessionId = project?._activeSessionId
  const session = sessionId ? project?._sessions[sessionId] : undefined
  if (!unsentSession(session)) {
    await useChatStore.getState().resetSession()
    return
  }
  writeFocusedSelection(path, selectionForNewSession(checkout.environmentId), {
    cwd: path,
    worktreePath: null,
    gitBranch: null,
  })
  useAppStore.getState().setActiveWorktree(path, null)
}
