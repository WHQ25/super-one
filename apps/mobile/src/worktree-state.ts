import type { WorktreeMode } from '@superone/shared/agent-types'

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

export type WorktreeCreateOptions = {
  gitBranch?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeMode?: WorktreeMode
  worktreeBranchName?: string
  worktreeCarryLocalChanges?: boolean
}

export function buildWorktreeCreateOptions(
  selection: NewSessionWorktreeSelection,
  currentBranch?: string | null,
): WorktreeCreateOptions {
  if (selection.kind === 'local') {
    return currentBranch ? { gitBranch: currentBranch } : {}
  }
  if (selection.kind === 'existing') {
    return {
      worktreePath: selection.path,
      ...(selection.branch ? { gitBranch: selection.branch } : {}),
    }
  }
  return {
    worktreeBranch: selection.baseBranch,
    worktreeMode: selection.mode,
    ...(selection.mode === 'branch'
      ? { worktreeBranchName: selection.branchName.trim() }
      : {}),
    worktreeCarryLocalChanges: selection.carryLocalChanges,
  }
}

export function worktreeSelectionError(
  selection: NewSessionWorktreeSelection,
  branches: string[],
  checkedOutBranches: string[],
): string | null {
  if (selection.kind !== 'create') return null
  if (!selection.baseBranch) return 'Choose a base branch.'
  if (selection.mode === 'branch') {
    const name = selection.branchName.trim()
    if (!name) return 'Enter a new branch name.'
    if (branches.includes(name)) return `Branch "${name}" already exists.`
  }
  if (selection.mode === 'attach' && checkedOutBranches.includes(selection.baseBranch)) {
    return `Branch "${selection.baseBranch}" is already checked out.`
  }
  return null
}
