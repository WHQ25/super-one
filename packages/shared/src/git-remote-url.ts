/**
 * Compare git remotes across machines. One repository is reached as
 * `git@github.com:o/r.git` on one machine and `https://github.com/o/r` on
 * another; both normalize to `github.com/o/r`.
 */

/** `host/path` of a remote URL (scp-like, ssh://, https://, git://), lowercased; null when unparseable. */
export function normalizeGitRemoteUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim()
  if (!url) return null
  let hostAndPath: string | null = null
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i)
  if (scheme) hostAndPath = `${scheme[1]}/${scheme[2]}`
  else {
    const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/)
    if (scp) hostAndPath = `${scp[1]}/${scp[2]}`
  }
  if (!hostAndPath) return null
  const normalized = hostAndPath.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
  return normalized.includes('/') ? normalized : null
}

/** The normalized remote of a `git:<origin url>` project identity; null for any other identity. */
export function repoIdentityRemote(identity: string | null | undefined): string | null {
  return identity?.startsWith('git:') ? normalizeGitRemoteUrl(identity.slice(4)) : null
}
