import { displayHostPath } from '@superone/shared/remote-resource-key'

export type FileLinkTarget = { filePath: string; lineNumber?: number; endLine?: number }

/**
 * Split a trailing line annotation off a path. Both single lines and ranges are
 * accepted, in the forms citations actually use:
 * `#L10`, `#L10-20`, `#L10-L20`, `:10`, `:10-20`.
 *
 * A range whose end does not extend the start (`#L10-10`, `#L10-4`) collapses to
 * a single line so the chip never renders a degenerate range.
 */
export function parseFileLinkTarget(target: string): FileLinkTarget {
  const match = target.match(/^(.*)(?:#L|:)(\d+)(?:-L?(\d+))?$/)
  if (!match) return { filePath: target }

  const lineNumber = Number.parseInt(match[2], 10)
  const end = match[3] != null ? Number.parseInt(match[3], 10) : undefined
  return {
    filePath: match[1],
    lineNumber,
    ...(end != null && end > lineNumber ? { endLine: end } : {}),
  }
}

/** Chip suffix for a parsed line annotation: `#L10` or `#L10-20`. */
export function formatLineRange(lineNumber: number, endLine?: number): string {
  return endLine != null && endLine > lineNumber ? `#L${lineNumber}-${endLine}` : `#L${lineNumber}`
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
): FileLinkTarget | null {
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

  const { filePath: rawPath, lineNumber, endLine } = parseFileLinkTarget(href)
  const filePath = expandHomeInPath(safeDecodeFilePath(rawPath), homeDir)

  // Absolute local paths open in the editor whether or not they sit under the
  // current project (e.g. ~/.grok workflow artifacts, dependency sources).
  if (isAbsoluteLocalPath(filePath) || filePath.startsWith('/')) {
    return { filePath, lineNumber, endLine }
  }

  // Project-relative (including ./prefix). Never invent a path without a root.
  if (!projectRoot) return null
  const relative = filePath.replace(/^\.\//, '')
  if (!relative) return null
  return { filePath: `${projectRoot}/${relative}`, lineNumber, endLine }
}

export function clickReleasedOnSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (sel.toString().trim().length === 0) return false
  return sel.getRangeAt(0).intersectsNode(target)
}

/**
 * Project-relative path for opening / selecting a file, or the input unchanged
 * when it does not live under the project root.
 *
 * Remote projects are keyed in the stores as `remote:<connectionId>:<hostPath>`,
 * so the prefix must be compared against the host path — comparing against the
 * raw key never matches and leaks a host-absolute path into IPC that expects a
 * project-relative one.
 */
export function toProjectRelativePath(
  filePath: string,
  projectPath: string | null | undefined,
): string {
  if (!filePath || !projectPath) return filePath
  const root = displayHostPath(projectPath).replace(/[/\\]+$/, '')
  if (!root) return filePath
  return filePath.startsWith(root + '/') ? filePath.slice(root.length + 1) : filePath
}
