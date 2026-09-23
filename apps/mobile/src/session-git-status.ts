import type { WorktreeInfo } from '@superone/shared/agent-types'

/**
 * Every way the header can describe where a *running* session's checkout is.
 *
 * This is deliberately not `WorkDirChipState` from `worktree-state.ts`. That one
 * describes a session the user is still composing, so it has states this can
 * never reach (`createBranch`, `attachTo`) and cannot express the one this needs
 * most — a local session sitting on a branch, which the landing draws as a
 * second chip beside the work-dir chip rather than inside it.
 */
export type SessionGitView =
  | { kind: 'branch'; branch: string; dirtyFiles: number }
  | { kind: 'detached'; head: string }
  | { kind: 'worktreeBranch'; branch: string }
  | { kind: 'worktreeDetached'; head: string }
  | { kind: 'worktreeMissing' }

export type SessionGitFacts = {
  /** From the restore snapshot: the host says the process runs in a worktree. */
  isWorktree: boolean
  worktreePath: string | null
  /**
   * The worktree the session was created in is gone; the harness fell back to
   * the project directory (`worktree_missing`, via chat-core's `_worktreeRemoved`).
   */
  worktreeRemoved: boolean
  /** Snapshot branch — for a worktree session this is the worktree's own branch. */
  sessionBranch: string | null
  /** Live `get_git_info` on the project — turn end, session switch-back, branch page. */
  projectBranch: string | null
  /** Live short HEAD, present only when the project checkout is detached. */
  projectHead: string | null
  projectDirtyFiles: number
  /** Supplies a worktree's HEAD, which `get_git_info` on the project cannot see. */
  worktree: WorktreeInfo | null
}

/**
 * Which checkout the session is on, for the line under the chat title.
 *
 * Both prefer live data, because the snapshot branch is only what the session
 * started on. A local session shows the project branch, since switching branches
 * under a running session is allowed. A worktree session shows its own entry in
 * the worktree list — the project's branch says nothing about it, and a worktree
 * created detached can gain a branch later — falling back to the snapshot until
 * that list loads. Same order as the desktop's `WorkDirIndicator`.
 *
 * Dirty counts are local-only for the same reason: `projectDirtyFiles` counts the
 * project checkout, so showing it beside a worktree would be a confident lie.
 */
export function describeSessionGit(facts: SessionGitFacts): SessionGitView | null {
  if (facts.isWorktree && facts.worktreeRemoved) return { kind: 'worktreeMissing' }
  if (facts.isWorktree) {
    const entry = facts.worktreePath
      ? facts.worktree?.entries.find((candidate) => candidate.path === facts.worktreePath)
      : undefined
    const branch = (entry ? entry.branch : facts.sessionBranch)?.trim()
    if (branch) return { kind: 'worktreeBranch', branch }
    const head = entry?.head.slice(0, 7)
    return head ? { kind: 'worktreeDetached', head } : null
  }
  const branch = facts.projectBranch?.trim()
  if (branch) return { kind: 'branch', branch, dirtyFiles: facts.projectDirtyFiles }
  const head = facts.projectHead?.trim()
  return head ? { kind: 'detached', head } : null
}

/** Screen-reader sentence; also the accessibility label of the chip. */
export function sessionGitLabel(view: SessionGitView): string {
  switch (view.kind) {
    case 'branch':
      return view.dirtyFiles > 0
        ? `Branch ${view.branch}, ${view.dirtyFiles} uncommitted ${view.dirtyFiles === 1 ? 'file' : 'files'}`
        : `Branch ${view.branch}`
    case 'detached':
      return `Detached at ${view.head}`
    case 'worktreeBranch':
      return `Worktree on branch ${view.branch}`
    case 'worktreeDetached':
      return `Worktree detached at ${view.head}`
    case 'worktreeMissing':
      return 'Worktree missing — running in the project folder'
  }
}
