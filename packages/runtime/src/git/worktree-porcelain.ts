export interface WorktreePorcelainEntry {
  path: string
  branch: string | null
  bare: boolean
  head?: string
}

/**
 * Parse `git worktree list --porcelain` stdout into structured entries.
 * Host-agnostic: no process spawn.
 */
export function parseWorktreePorcelain(out: string): WorktreePorcelainEntry[] {
  const items: WorktreePorcelainEntry[] = []
  let current: Partial<WorktreePorcelainEntry> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) items.push(current as WorktreePorcelainEntry)
      current = { path: line.slice('worktree '.length), branch: null, bare: false }
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === '') {
      if (current.path) items.push(current as WorktreePorcelainEntry)
      current = {}
    }
  }
  if (current.path) items.push(current as WorktreePorcelainEntry)
  return items
}
