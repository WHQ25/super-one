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

const HTML_FILE_RE = /\.(?:html?)$/i

export function isHtmlFilePath(filePath: string): boolean {
  return HTML_FILE_RE.test(filePath)
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
 * Percent-encoded path separators (any case). Grok session dirs embed these as
 * literal folder names (`%2FUsers%2F…`); decoding them would invent separators.
 */
const ENCODED_PATH_SEPARATOR = /%2[fF]|%5[cC]/

/**
 * Decode markdown/streamdown percent-encoding in filesystem paths when safe.
 *
 * Streamdown / mdast-util-to-hast percent-encodes non-ASCII in link destinations
 * (e.g. Chinese filenames → `%E8%AF%8A…`). Those must become real filesystem
 * paths for open / show-in-folder / Add-to-chat.
 *
 * Safety rules:
 * - Never decode when the path contains encoded separators `%2F` / `%5C`
 *   (Grok-style literal directory names).
 * - Only accept a decode when `encodeURI(decoded)` round-trips to the input
 *   (normalized hex case), so partial/mixed encodings are left alone.
 * - On any decode failure, keep the raw string.
 *
 * Known boundary: a *literal* filename that contains a valid percent-escape
 * (e.g. a file actually named `file%20name.md` on disk) is indistinguishable
 * from URI encoding and will be decoded to `file name.md`. Real files with
 * `%XX` in the name are rare; markdown-encoded CJK is the common case.
 * Encoded separators still protect Grok session dirs.
 */
export function safeDecodeFilePath(path: string): string {
  if (!path || !/%[0-9A-Fa-f]{2}/.test(path)) return path
  if (ENCODED_PATH_SEPARATOR.test(path)) return path
  try {
    const decoded = decodeURIComponent(path)
    if (decoded === path) return path
    // Round-trip: streamdown uses URI-style percent-encoding of non-ASCII.
    // Normalize hex case so `%e8` and `%E8` both validate.
    const reencoded = encodeURI(decoded)
    const norm = (s: string) => s.replace(/%[0-9A-Fa-f]{2}/g, (m) => m.toUpperCase())
    if (norm(reencoded) === norm(path)) return decoded
    return path
  } catch {
    return path
  }
}

/**
 * Resolve a markdown href into a local filesystem path (+ optional line).
 * - http(s) / mailto / etc. → null (browser links)
 * - absolute paths and file:// → always a file (in- or out-of-project)
 * - ~/ paths → expanded when homeDir is known
 * - relative paths → joined to projectRoot (requires projectRoot)
 *
 * Non-ASCII segments percent-encoded by the markdown pipeline are decoded via
 * {@link safeDecodeFilePath}. Grok session dirs that embed literal `%2F…`
 * segments are left intact so they do not gain extra path separators.
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
        // file:// URLs legitimately percent-encode; decode the pathname safely
        // (same Grok-%2F guard as bare paths — do not invent separators).
        href = safeDecodeFilePath(url.pathname)
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
  const filePath = expandHomeInPath(safeDecodeFilePath(rawPath), homeDir)

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
