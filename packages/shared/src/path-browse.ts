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

/**
 * True when the path already points at a directory (`~`, `~/`, `./foo/`) so the
 * next character typed starts a brand-new segment.
 */
export function isBrowseDirectoryBoundary(currentPath: string): boolean {
  const trimmed = currentPath.trim()
  return hasTrailingPathSeparator(trimmed) || isBareHomePath(trimmed)
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

/**
 * Inline path autocomplete for the add-project input.
 *
 * Prefix match only: typed query stays solid; muted text is painted after it
 * (e.g. `~/Deve` + ghost `loper`). Fuzzy hits stay in the list, not the input.
 */
export type PathInlineGhost =
  /** Tab-completable remainder of the highlighted directory name. */
  | { kind: 'suffix'; text: string }
  /** Read-only preview of what submitting would append (not Tab-completable). */
  | { kind: 'preview'; text: string }

/**
 * Build the inline ghost for the highlighted directory candidate.
 * Returns null when the leaf is not a prefix of the candidate.
 */
export function getPathInlineGhost(
  query: string,
  selectedDirectoryName: string | null | undefined,
): PathInlineGhost | null {
  if (!selectedDirectoryName) return null

  const leaf = getBrowseLeafPathSegment(query)
  const sep = preferredPathSeparator(query || '/')

  // At a directory boundary nothing has been typed for this segment yet, so
  // ghosting the highlighted child would read as "this is the path you are
  // about to use" — misleading, since submit uses the typed path, not the
  // highlighted row. Callers preview their own target instead.
  if (!leaf) return null

  const nameLower = selectedDirectoryName.toLowerCase()
  const leafLower = leaf.toLowerCase()

  if (!nameLower.startsWith(leafLower)) return null
  if (selectedDirectoryName.length === leaf.length) {
    return { kind: 'suffix', text: sep }
  }
  return { kind: 'suffix', text: selectedDirectoryName.slice(leaf.length) }
}

/**
 * Ghost for the clone destination step. At a directory boundary the repository
 * is cloned into `<query><repoName>`, so preview that folder name rather than a
 * sibling directory the user never chose.
 */
export function getClonePreviewGhost(
  query: string,
  repoName: string | null | undefined,
): PathInlineGhost | null {
  if (!repoName) return null
  if (!isBrowseDirectoryBoundary(query)) return null
  return { kind: 'preview', text: repoName }
}

/** @deprecated Prefer getPathInlineGhost — kept for callers that only need suffix text. */
export function getPathInlineGhostSuffix(
  query: string,
  selectedDirectoryName: string | null | undefined,
): string {
  const ghost = getPathInlineGhost(query, selectedDirectoryName)
  return ghost?.kind === 'suffix' ? ghost.text : ''
}
