import type { WorktreeMode } from './agent-types'
import { parseRemoteProjectKey } from './remote-resource-key'

/**
 * Where a new session will run. Shared by desktop and mobile so a draft saved
 * on one can open on the other.
 */
export type NewSessionWorktreeSelection =
  | { kind: 'local' }
  | { kind: 'existing'; path: string; branch?: string }
  | {
      kind: 'create'
      baseBranch: string
      mode: WorktreeMode
      branchName: string
      carryLocalChanges: boolean
    }

export const LOCAL_WORKTREE_SELECTION: NewSessionWorktreeSelection = { kind: 'local' }

/** The session or draft owns both the machine and the checkout. */
export interface SessionEnvironmentSelection {
  environmentId: string
  selection: NewSessionWorktreeSelection
}

export function selectionForNewSession(environmentId: string): SessionEnvironmentSelection {
  return { environmentId, selection: LOCAL_WORKTREE_SELECTION }
}

/**
 * Connection id carried by a project route. Local folders have none.
 * This is the environment id a session can know before the catalog loads.
 */
export function environmentIdForProjectKey(projectPath: string | null | undefined): string {
  return parseRemoteProjectKey(projectPath ?? '')?.connectionId ?? 'local'
}

/** Draft JSON that names where the next session runs. Older rows omit the new fields. */
export interface DraftWorktreeFields {
  environmentId?: string | null
  worktreeSelection?: NewSessionWorktreeSelection | null
  worktreePath?: string | null
  gitBranch?: string | null
  pendingBaseBranch?: string | null
  pendingWorktreeMode?: string | null
  pendingBranchName?: string | null
  pendingCarryLocalChanges?: boolean
}

/** Restore a selection from a draft. An explicit selection wins over legacy pending fields. */
export function selectionFromDraftFields(
  settings: DraftWorktreeFields | null | undefined,
): SessionEnvironmentSelection | null {
  if (!settings) return null
  const environmentId = settings.environmentId || 'local'
  if (settings.worktreeSelection) return { environmentId, selection: settings.worktreeSelection }
  if (settings.worktreePath) {
    return {
      environmentId,
      selection: {
        kind: 'existing',
        path: settings.worktreePath,
        ...(settings.gitBranch ? { branch: settings.gitBranch } : {}),
      },
    }
  }
  if (settings.pendingBaseBranch) {
    const mode = settings.pendingWorktreeMode
    return {
      environmentId,
      selection: {
        kind: 'create',
        baseBranch: settings.pendingBaseBranch,
        mode: mode === 'attach' || mode === 'detach' ? mode : 'branch',
        branchName: settings.pendingBranchName ?? '',
        carryLocalChanges: !!settings.pendingCarryLocalChanges,
      },
    }
  }
  if (settings.environmentId) return selectionForNewSession(environmentId)
  return null
}
