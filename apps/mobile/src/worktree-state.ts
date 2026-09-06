import type { WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'

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

/**
 * Every way the working-directory chip can describe where a session will run.
 * Mirrors the desktop `WorkDirState` in
 * `apps/desktop/src/renderer/src/components/chat/work-dir-label.tsx` — keep the
 * two speaking one language. The desktop's `local.host` axis has no mobile
 * counterpart: every project a phone sees lives on the paired desktop.
 */
export type WorkDirChipState =
  | { kind: 'local' }
  | { kind: 'activeBranch'; name: string }
  | { kind: 'activeDetached'; hash: string }
  | { kind: 'createBranch'; name: string }
  | { kind: 'attachTo'; base: string }
  | { kind: 'createFrom'; base: string }

/** Short HEAD of an already-existing worktree, for the detached label. */
function shortHead(path: string, worktree?: WorktreeInfo | null): string {
  const head = worktree?.entries.find((entry) => entry.path === path)?.head ?? ''
  return head.slice(0, 7)
}

export function workDirChipState(
  selection: NewSessionWorktreeSelection,
  worktree?: WorktreeInfo | null,
): WorkDirChipState {
  if (selection.kind === 'existing') {
    return selection.branch
      ? { kind: 'activeBranch', name: selection.branch }
      : { kind: 'activeDetached', hash: shortHead(selection.path, worktree) }
  }
  if (selection.kind === 'create') {
    if (selection.mode === 'branch') return { kind: 'createBranch', name: selection.branchName.trim() }
    if (selection.mode === 'attach') return { kind: 'attachTo', base: selection.baseBranch }
    return { kind: 'createFrom', base: selection.baseBranch }
  }
  return { kind: 'local' }
}
