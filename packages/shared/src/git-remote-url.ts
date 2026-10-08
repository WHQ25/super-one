/**
 * Compare git remotes across machines. One repository is reached as
 * `git@github.com:o/r.git` on one machine and `https://github.com/o/r` on
 * another; both normalize to `github.com/o/r`.
 */

/** Port each scheme uses when the URL names none. */
const DEFAULT_PORTS: Record<string, string> = { ssh: '22', 'git+ssh': '22', https: '443', http: '80', git: '9418' }

/** Hosts whose repository paths are case-insensitive; elsewhere `O/R` and `o/r` may differ. */
const CASE_INSENSITIVE_PATH_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])

/**
 * `host[:port]/path` of a remote URL (scp-like, ssh://, https://, git://);
 * null when unparseable. The host is lowercased and a scheme's default port
 * dropped; the path keeps its case except on known case-insensitive hosts.
 */
export function normalizeGitRemoteUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim()
  if (!url) return null
  let host: string
  let port: string | undefined
  let path: string
  const scheme = url.match(/^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::(\d+))?\/(.+)$/i)
  if (scheme) {
    host = scheme[2]!
    port = scheme[3] && scheme[3] !== DEFAULT_PORTS[scheme[1]!.toLowerCase()] ? scheme[3] : undefined
    path = scheme[4]!
  } else {
    const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/)
    if (!scp) return null
    host = scp[1]!
    path = scp[2]!
  }
  host = host.toLowerCase()
  path = path.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!path) return null
  if (CASE_INSENSITIVE_PATH_HOSTS.has(host)) path = path.toLowerCase()
  return `${host}${port ? `:${port}` : ''}/${path}`
}

/** The normalized remote of a `git:<origin url>` project identity; null for any other identity. */
export function repoIdentityRemote(identity: string | null | undefined): string | null {
  return identity?.startsWith('git:') ? normalizeGitRemoteUrl(identity.slice(4)) : null
}
