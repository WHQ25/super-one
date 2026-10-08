/**
 * Bring a checkout's remote-tracking refs up to date before cutting a
 * worktree from them: fetch the remote, then refresh `<remote>/HEAD` (set
 * only at clone time, so an older checkout may lack it). The second command
 * is best effort.
 */
export function fetchRemoteCommands(remote: string): { fetch: string[]; setHead: string[] } {
  return {
    fetch: ['fetch', '--quiet', '--prune', remote],
    setHead: ['remote', 'set-head', remote, '--auto'],
  }
}

/** A remote name `git fetch` may take: no options, paths or refspecs. */
export function isGitRemoteName(remote: string): boolean {
  return /^[A-Za-z0-9][\w.-]*$/.test(remote)
}
