import type { WorktreeInfo } from '@superone/shared/agent-types'
import type { ShellGitInfo } from '../screens/settings-screen'

/**
 * One repository the whole preview agrees on, so the chips, the working
 * directory sheet and the branch sheet describe the same checkout. It has to
 * be rich enough to reach every state: a detached worktree, a branch that is
 * already checked out elsewhere (which blocks `attach`), and a dirty tree.
 */
export const PREVIEW_GIT_INFO: ShellGitInfo = {
  branch: 'feat/mobile-ui',
  ahead: 2,
  behind: 1,
  // Four-digit insertions on purpose: only then does the thousands separator show.
  dirty: { files: 27, insertions: 1231, deletions: 75 },
}

export const PREVIEW_WORKTREE_INFO: WorktreeInfo = {
  isWorktree: false,
  currentBranch: 'feat/mobile-ui',
  entries: [
    { path: '/workspace/super-one', branch: 'feat/mobile-ui', head: 'aa11bb22cc33dd44', isMain: true, isCurrent: true },
    { path: '/workspace/.worktrees/review', branch: 'review/pr-482', head: '4c8e0b19a7f3', isMain: false, isCurrent: false },
    { path: '/workspace/.worktrees/detached', branch: '', head: '9f3c1d7e5a20', isMain: false, isCurrent: false },
  ],
}

/** One dirty worktree and one clean one, so both right-hand labels are reachable. */
export const PREVIEW_WORKTREE_DIRTY: Record<string, number> = {
  '/workspace/.worktrees/review': 4,
  '/workspace/.worktrees/detached': 0,
}

export const PREVIEW_BRANCHES = [
  'main', 'feat/mobile-ui', 'review/pr-482', 'release/1.4',
  'fix/pairing-timeout', 'chore/dependency-bump',
]

/** `release/1.4` is checked out in another worktree, so `attach` must refuse it. */
export const PREVIEW_CHECKED_OUT = ['feat/mobile-ui', 'review/pr-482', 'release/1.4']

/** Switching to a branch the dirty tree blocks, so the sheet's error path is reachable. */
export const PREVIEW_BLOCKED_BRANCH = 'main'

export async function previewSwitchBranch(branch: string): Promise<void> {
  if (branch === PREVIEW_BLOCKED_BRANCH) {
    throw new Error('error: Your local changes to "src/ui/git-chips.tsx" would be overwritten by checkout.')
  }
}
