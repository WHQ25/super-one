import type { WorktreeEntry, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'

/** Non-main worktrees matching the search box, matched on branch, HEAD and path. */
export function filterWorktreeEntries(
  worktree: WorktreeInfo | null | undefined,
  query: string,
): WorktreeEntry[] {
  const entries = (worktree?.entries ?? []).filter((entry) => !entry.isMain)
  const search = query.trim().toLowerCase()
  if (!search) return entries
  return entries.filter((entry) => (
    [entry.branch, entry.head, entry.path].filter(Boolean).join(' ').toLowerCase().includes(search)
  ))
}

/**
 * Why `attach` cannot use a branch, or null when it can. Git refuses to check
 * a branch out twice, so the desktop names which checkout already holds it
 * rather than failing at creation time.
 */
export function attachUnavailableReason(
  branch: string,
  worktree: WorktreeInfo | null | undefined,
  checkedOutBranches: readonly string[],
): string | null {
  if (!worktree) return null
  if (!checkedOutBranches.includes(branch)) return null
  const main = worktree.entries.find((entry) => entry.isMain)
  return main?.branch === branch
    ? 'Already checked out in main repo'
    : 'Already checked out in another worktree'
}

/** Heading above the branch list, which names what picking a branch will do. */
export function worktreeBranchHeading(mode: WorktreeMode | null): string {
  if (mode === 'attach') return 'Attach to'
  if (mode === 'detach') return 'Detach at'
  return 'Create new worktree from'
}
