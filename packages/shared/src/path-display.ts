const HOME_RE = /^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)/

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p
}

function posixRelative(from: string, to: string): string | null {
  const a = stripTrailingSlash(to)
  const b = stripTrailingSlash(from)
  if (!a.startsWith('/') || !b.startsWith('/')) return null
  if (a === b) return '.'
  const aParts = a.split('/').filter(Boolean)
  const bParts = b.split('/').filter(Boolean)
  let i = 0
  while (i < aParts.length && i < bParts.length && aParts[i] === bParts[i]) i++
  const ups = bParts.length - i
  const rest = aParts.slice(i)
  const parts: string[] = []
  for (let k = 0; k < ups; k++) parts.push('..')
  parts.push(...rest)
  return parts.length === 0 ? '.' : parts.join('/')
}

export function shortenPath(absolutePath: string, cwd?: string | null, homedir?: string | null): string {
  if (!absolutePath) return absolutePath

  const candidates: string[] = [absolutePath]

  if (cwd) {
    const rel = posixRelative(cwd, absolutePath)
    if (rel != null) candidates.push(rel)
  }

  if (homedir && absolutePath === homedir) {
    candidates.push('~')
  } else if (homedir && absolutePath.startsWith(homedir + '/')) {
    candidates.push('~/' + absolutePath.slice(homedir.length + 1))
  } else {
    const homeMatch = absolutePath.match(HOME_RE)
    if (homeMatch) {
      candidates.push('~' + absolutePath.slice(homeMatch[0].length))
    }
  }

  return candidates.reduce((a, b) => (a.length <= b.length ? a : b))
}

export function homePath(absolutePath: string): string {
  return absolutePath.replace(HOME_RE, '~')
}


/**
 * The desktop's `local-file://` URL for an absolute path — the scheme the
 * renderer loads project and session-zone media through. One definition for
 * both processes: the main process hands these out for zone media and the
 * renderer builds them for local files, and they have to agree on encoding.
 */
export function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = encodeURI(normalized).replace(/#/g, '%23')
  return /^[A-Za-z]:/.test(normalized) ? `local-file:///${encoded}` : `local-file://${encoded}`
}

/** The absolute path a `local-file://` URL names, or null for any other URL. */
export function localFileUrlToPath(url: string): string | null {
  if (!url.startsWith('local-file://')) return null
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    // Windows: `local-file:///C:/x` has pathname `/C:/x`.
    return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}
