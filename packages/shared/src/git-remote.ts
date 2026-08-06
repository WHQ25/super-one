/**
 * Git remote parsing for the add-project clone flow.
 *
 * Shared by three consumers that must agree on the exact same rules:
 * the renderer (previews the destination path before cloning), the desktop
 * main process (local clone), and the CLI node (remote clone over RPC).
 */

export interface GitHubRepoRef {
  owner: string
  repo: string
}

/** GitHub allows alphanumerics, `-`, `_`, `.` in owner and repo names. */
const GITHUB_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Accepts what a user realistically pastes for a GitHub repo:
 * `owner/repo`, a browser URL (with or without scheme), or an SSH remote.
 * Returns null when the input is not GitHub-shaped — the caller then treats
 * it as a raw Git URL.
 */
export function parseGitHubRepoInput(input: string): GitHubRepoRef | null {
  let value = input.trim()
  if (!value) return null

  // https://github.com/owner/repo(.git)(/tree/main…), git@github.com:owner/repo.git,
  // or a bare github.com/owner/repo paste without a scheme.
  const urlMatch = value.match(
    /^(?:(?:https?:\/\/|ssh:\/\/git@|git@|git:\/\/)?(?:www\.)?github\.com[/:]+)(.+)$/i,
  )
  if (urlMatch) value = urlMatch[1]

  const segments = value
    .replace(/\.git$/i, '')
    .split('/')
    .filter((segment) => segment.length > 0)
  if (segments.length < 2) return null

  const [owner, repo] = segments
  if (!GITHUB_SEGMENT.test(owner) || !GITHUB_SEGMENT.test(repo)) return null
  return { owner, repo }
}

export function buildGitHubCloneUrl(ref: GitHubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`
}

/**
 * Owner avatar used in marketplace logos and the add-project GitHub picker.
 * Same URL shape GitHub serves for user/org profile images.
 */
export function githubOwnerAvatarUrl(owner: string, size = 80): string {
  return `https://github.com/${encodeURIComponent(owner)}.png?size=${size}`
}

/**
 * After the user types `owner/`, the GitHub step can search that owner's repos.
 * Returns null until a slash is present (so bare `owner` does not trigger a
 * network call) and for full GitHub URLs (those resolve without search).
 */
export function parseGitHubOwnerSearchQuery(
  raw: string,
): { owner: string; repoPrefix: string } | null {
  const value = raw.trim()
  if (!value) return null
  // Full clone/browser URLs (with or without scheme) resolve without search.
  if (
    /^(?:https?:\/\/|ssh:\/\/|git@|git:\/\/)/i.test(value) ||
    /^(?:www\.)?github\.com[/:]/i.test(value)
  ) {
    return null
  }

  const slash = value.indexOf('/')
  if (slash <= 0) return null

  const owner = value.slice(0, slash)
  const repoPrefix = value.slice(slash + 1).replace(/\.git$/i, '')
  if (!GITHUB_SEGMENT.test(owner)) return null
  // Allow an empty prefix (`owner/`) and a partial repo name; reject junk.
  if (repoPrefix && !/^[A-Za-z0-9._-]*$/.test(repoPrefix)) return null
  return { owner, repoPrefix }
}

/**
 * Directory name `git clone` would pick on its own — used to preview and to
 * pass an explicit destination so the caller controls the final path.
 */
export function repoNameFromGitUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  // Scheme-only fragments (`https:`) are not a folder name.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:$/.test(trimmed)) return null
  // scheme://host with no path — nothing to name the clone after.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]+$/.test(trimmed)) return null

  // Strip scp-like `user@host:` and any `scheme://host` prefix before splitting.
  const withoutHost = trimmed
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*\//, '')
    .replace(/^[^/@]+@[^:/]+:/, '')
  // Still looks like a URL after stripping → path never appeared.
  if (withoutHost === trimmed && /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return null

  const last = withoutHost.split('/').filter(Boolean).pop()
  if (!last) return null
  const name = last.replace(/\.git$/i, '')
  // Reject anything that would escape the chosen parent directory.
  if (!name || name === '.' || name === '..' || name.includes('\0')) return null
  // A bare scheme token (e.g. from `https://`) must never become the folder name.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:$/.test(name)) return null
  return name
}

/**
 * Guard the string that reaches `git clone`. Returns an error reason, or null
 * when the URL is safe to pass through.
 *
 * Two attacks matter here: a leading `-` makes git read the "URL" as a flag,
 * and git's `<helper>::<payload>` transport syntax (notably `ext::`) executes
 * an arbitrary shell command on clone.
 *
 * Half-typed scheme prefixes (`https://`, `https://github.com`) are rejected so
 * the add-project dialog does not auto-advance while the user is still typing.
 */
export function validateCloneRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'remote URL is required'
  if (trimmed.includes('\0') || /\s/.test(trimmed)) return 'remote URL contains invalid characters'
  if (trimmed.startsWith('-')) return 'remote URL cannot start with "-"'
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(trimmed)) {
    return 'git transport helper URLs are not allowed'
  }

  const schemeMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/,
  )
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (!['https', 'http', 'ssh', 'git'].includes(scheme)) {
      return `unsupported URL scheme: ${scheme}`
    }
    const host = schemeMatch[2]
    if (!host) return 'remote URL is missing a host'
    const pathSegments = (schemeMatch[3] ?? '').split('/').filter(Boolean)
    if (pathSegments.length < 1) {
      return 'remote URL must include a repository path'
    }
    return null
  }

  // Bare scheme or scheme:// without a parseable host/path (e.g. `https://`).
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    return 'remote URL is incomplete'
  }

  // scp-like syntax: user@host:path
  if (/^[^/@\s]+@[^:/\s]+:.+$/.test(trimmed)) return null

  return 'remote URL must be an https, ssh or git URL'
}
