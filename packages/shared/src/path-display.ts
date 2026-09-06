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

