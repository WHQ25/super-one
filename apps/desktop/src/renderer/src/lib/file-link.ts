export function parseFileLinkTarget(target: string): { filePath: string; lineNumber?: number } {
  const hashMatch = target.match(/^(.*)#L(\d+)$/)
  if (hashMatch) {
    return {
      filePath: hashMatch[1],
      lineNumber: Number.parseInt(hashMatch[2], 10),
    }
  }

  const colonMatch = target.match(/^(.*):(\d+)$/)
  if (colonMatch) {
    return {
      filePath: colonMatch[1],
      lineNumber: Number.parseInt(colonMatch[2], 10),
    }
  }

  return { filePath: target }
}

export function normalizeFileLinkTarget(target: string): string {
  return parseFileLinkTarget(target).filePath
}

export function isAbsoluteLocalPath(filePath: string): boolean {
  return filePath.startsWith('/')
    || filePath.startsWith('~/')
    || filePath === '~'
    || /^[A-Za-z]:[\\/]/.test(filePath)
}

/**
 * Expand `~/…` using an explicit home dir, or a heuristic from projectRoot / cwd.
 * Grok often cites paths under `~/.grok/…` — those must open as absolute paths.
 */
export function expandHomeInPath(filePath: string, homeDir?: string | null): string {
  if (filePath !== '~' && !filePath.startsWith('~/')) return filePath
  let home = homeDir?.trim() || ''
  if (!home) {
    // Heuristic: /Users/<name> or /home/<name> from known absolute roots.
    // Prefer process.env when available (preload/renderer in Electron).
    try {
      const envHome = typeof process !== 'undefined' ? process.env?.HOME || process.env?.USERPROFILE : undefined
      if (envHome) home = envHome
    } catch { /* ignore */ }
  }
  if (!home) {
    // Last resort: recover from a macOS/Linux absolute path pattern if we can.
    return filePath
  }
  if (filePath === '~') return home
  return `${home.replace(/[/\\]$/, '')}/${filePath.slice(2)}`
}

/**
 * Resolve a markdown href into a local filesystem path (+ optional line).
 * - http(s) / mailto / etc. → null (browser links)
 * - absolute paths and file:// → always a file (in- or out-of-project)
 * - ~/ paths → expanded when homeDir is known
 * - relative paths → joined to projectRoot (requires projectRoot)
 *
 * IMPORTANT: Grok session dirs embed URL-encoded segments as literal folder
 * names (`%2FUsers%2F…`). Never decodeURIComponent absolute filesystem paths —
 * that would turn a single directory name into extra path separators.
 */
export function resolveProjectFileHref(
  rawHref: string,
  projectRoot: string,
  homeDir?: string | null,
): { filePath: string; lineNumber?: number } | null {
  if (!rawHref) return null

  let href = rawHref

  // Drive-letter paths must not go through URL() — "C:\foo" is parsed as scheme "c:".
  if (!/^[A-Za-z]:[\\/]/.test(href) && !href.startsWith('/') && !href.startsWith('~/') && href !== '~') {
    try {
      const url = new URL(href)
      // Network URLs are never project files — not even localhost.
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return null
      }
      if (url.protocol === 'file:' || url.protocol === 'local-file:') {
        // file:// URLs legitimately percent-encode; decode the pathname only.
        try {
          href = decodeURIComponent(url.pathname)
        } catch {
          href = url.pathname
        }
        // Windows file URLs look like file:///C:/Users/... → pathname /C:/Users/...
        if (/^\/[A-Za-z]:\//.test(href)) href = href.slice(1)
      } else {
        // mailto:, javascript:, data:, etc.
        return null
      }
    } catch {
      // Not an absolute URL — treat as a filesystem path (absolute or project-relative).
    }
  }

  const { filePath: rawPath, lineNumber } = parseFileLinkTarget(href)
  const filePath = expandHomeInPath(rawPath, homeDir)

  // Absolute local paths open in the editor whether or not they sit under the
  // current project (e.g. ~/.grok workflow artifacts, dependency sources).
  if (isAbsoluteLocalPath(filePath) || filePath.startsWith('/')) {
    return { filePath, lineNumber }
  }

  // Project-relative (including ./prefix). Never invent a path without a root.
  if (!projectRoot) return null
  const relative = filePath.replace(/^\.\//, '')
  if (!relative) return null
  return { filePath: `${projectRoot}/${relative}`, lineNumber }
}

export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}
