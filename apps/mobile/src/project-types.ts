/** Git status of a project, as `get_git_info` reports it. */
export type ShellGitInfo = {
  /** Null on a detached HEAD — read `head` instead, never render "HEAD". */
  branch: string | null
  /** Short HEAD, sent only when the checkout is detached. */
  head?: string | null
  ahead?: number
  behind?: number
  dirty?: { files: number; insertions: number; deletions: number }
}

/** A project the paired host has open, with its Git status once it arrives. */
export type Project = { path: string; name: string; git?: ShellGitInfo }
