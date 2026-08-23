import type { RecentFolder } from '@superone/shared/agent-types'

/**
 * The name to show for a project path.
 *
 * Several surfaces used to recompute `basename(path)` independently, which
 * silently ignored a user's custom name while the sidebar showed it — the two
 * disagreed on the same project. The registry entry is the source of truth;
 * basename is only the fallback for a path not in the list (a worktree, or a
 * folder opened before the list loaded).
 */
export function projectDisplayName(
  folders: readonly RecentFolder[],
  path: string | null | undefined,
): string {
  if (!path) return ''
  return folders.find((f) => f.path === path)?.name ?? basenameOf(path)
}

function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
