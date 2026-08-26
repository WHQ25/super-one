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

export function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = encodeURI(normalized).replace(/#/g, '%23')
  return /^[A-Za-z]:/.test(normalized)
    ? `local-file:///${encoded}`
    : `local-file://${encoded}`
}

export function toAssetUrl(path: string | undefined | null): string | null {
  if (!path) return null
  if (/^(?:https?:|data:|blob:|file:|local-file:)/.test(path)) return path
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return toLocalFileUrl(path)
  return null
}

export function resolveAssetUrls(paths: Array<string | undefined | null>): string[] {
  const urls = paths
    .map((path) => toAssetUrl(path))
    .filter((path): path is string => path !== null)
  return Array.from(new Set(urls))
}

let _mediaServerPort = 0
let _portFetch: Promise<number> | null = null
const _portListeners = new Set<(port: number) => void>()

export function mediaUrlFor(filePath: string, port: number): string {
  if (port > 0) {
    const normalized = filePath.replace(/\\/g, '/')
    return `http://127.0.0.1:${port}${encodeURI(normalized).replace(/#/g, '%23')}`
  }
  return toLocalFileUrl(filePath)
}

function notifyMediaServerPort(port: number): void {
  if (port <= 0 || port === _mediaServerPort) return
  _mediaServerPort = port
  for (const listener of _portListeners) listener(port)
}

/** Retry until the main-process media server is listening. A one-shot read at
 * module load often sees port 0 (listen callback has not fired) and would
 * otherwise pin every later `toMediaUrl` to local-file://. */
export function ensureMediaServerPort(): Promise<number> {
  if (_mediaServerPort > 0) return Promise.resolve(_mediaServerPort)
  if (typeof window === 'undefined' || !window.app?.getMediaServerPort) return Promise.resolve(0)
  if (!_portFetch) {
    _portFetch = (async () => {
      try {
        for (let attempt = 0; attempt < 40; attempt++) {
          // The loop outlives the window it started in (teardown, navigation),
          // so re-check rather than trusting the guard above.
          if (typeof window === 'undefined' || !window.app?.getMediaServerPort) return 0
          const port = await window.app.getMediaServerPort()
          if (port > 0) {
            notifyMediaServerPort(port)
            return port
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return 0
      } finally {
        if (_mediaServerPort <= 0) _portFetch = null
      }
    })()
  }
  return _portFetch
}

export function getMediaServerPortSync(): number {
  return _mediaServerPort
}

export function subscribeMediaServerPort(listener: (port: number) => void): () => void {
  _portListeners.add(listener)
  if (_mediaServerPort > 0) {
    const port = _mediaServerPort
    queueMicrotask(() => listener(port))
  } else {
    void ensureMediaServerPort()
  }
  return () => { _portListeners.delete(listener) }
}

// Guards the module being imported outside a renderer (tests, node tooling).
// `window.app` is injected by preload, so its methods are always present there.
if (typeof window !== 'undefined' && window.app) {
  void ensureMediaServerPort()
}

export function toMediaUrl(filePath: string): string {
  return mediaUrlFor(filePath, _mediaServerPort)
}
