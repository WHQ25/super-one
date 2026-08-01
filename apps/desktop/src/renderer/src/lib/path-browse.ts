/** Lightweight path helpers for the T3-style add-project browser (posix-first). */

export function hasTrailingPathSeparator(path: string): boolean {
  return path.endsWith('/') || path.endsWith('\\')
}

export function preferredPathSeparator(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/'
}

export function getLastPathSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

/**
 * Bare `~` is already a complete home-directory reference (shell-style), not a
 * half-typed leaf named "~". Treat it like `~/` for listing and completion.
 */
export function isBareHomePath(path: string): boolean {
  return path.trim() === '~'
}

/**
 * Expand a just-typed bare `~` into `~/` so the user can keep typing a path
 * without also typing the separator.
 *
 * Backspacing from `~/` (or `~\`) back to `~` is left alone — re-expanding
 * would trap the caret. Listing still treats bare `~` as home.
 */
export function normalizeHomePrefixInput(previous: string, next: string): string {
  if (!isBareHomePath(next)) return next
  const prev = previous.trim()
  if (prev === '~/' || prev === '~\\') return next
  return '~/'
}

/** Directory portion used for listing (includes trailing separator when present). */
export function getBrowseDirectoryPath(currentPath: string): string {
  if (!currentPath) return ''
  if (hasTrailingPathSeparator(currentPath)) return currentPath
  // Home without a slash still means "list the home directory".
  if (isBareHomePath(currentPath)) return '~/'
  const i = getLastPathSeparatorIndex(currentPath)
  return i < 0 ? currentPath : currentPath.slice(0, i + 1)
}

export function getBrowseLeafPathSegment(currentPath: string): string {
  if (hasTrailingPathSeparator(currentPath) || isBareHomePath(currentPath)) return ''
  const i = getLastPathSeparatorIndex(currentPath)
  return currentPath.slice(i + 1)
}

export function ensureBrowseDirectoryPath(currentPath: string): string {
  const trimmed = currentPath.trim()
  if (!trimmed || hasTrailingPathSeparator(trimmed)) return trimmed
  if (isBareHomePath(trimmed)) return '~/'
  return `${trimmed}${preferredPathSeparator(trimmed)}`
}

export function trimTrailingPathSeparators(path: string): string {
  return path.replace(/[/\\]+$/, '') || path
}

export function getBrowseParentPath(currentPath: string): string | null {
  const trimmed = trimTrailingPathSeparators(currentPath.trim())
  // `/` and bare `~` are roots — there is no parent expressible in the same form.
  if (!trimmed || trimmed === '/' || trimmed === '~') return null
  // Windows drive root e.g. C:
  if (/^[A-Za-z]:$/.test(trimmed)) return null
  const i = getLastPathSeparatorIndex(trimmed)
  if (i < 0) return null
  if (i === 0) return '/'
  // Keep "C:/" style roots
  if (/^[A-Za-z]:[/\\]$/.test(trimmed.slice(0, i + 1))) return trimmed.slice(0, i + 1)
  return ensureBrowseDirectoryPath(trimmed.slice(0, i + 1))
}

/** Join a directory and a child name without a trailing separator. */
export function joinBrowsePath(dir: string, segment: string): string {
  const sep = preferredPathSeparator(dir)
  const base = trimTrailingPathSeparators(dir)
  return base === sep ? `${sep}${segment}` : `${base}${sep}${segment}`
}

export function appendBrowsePathSegment(currentPath: string, segment: string): string {
  const sep = preferredPathSeparator(currentPath || '/')
  const dir = getBrowseDirectoryPath(currentPath) || (sep === '\\' ? '' : '/')
  return `${dir}${segment}${sep}`
}

export function isBrowseablePathQuery(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  return (
    v.startsWith('/') ||
    v.startsWith('~/') ||
    // Windows users may type a backslash after ~; both expand to homedir().
    v.startsWith('~\\') ||
    v === '~' ||
    v.startsWith('./') ||
    v.startsWith('../') ||
    /^[A-Za-z]:[/\\]/.test(v)
  )
}
