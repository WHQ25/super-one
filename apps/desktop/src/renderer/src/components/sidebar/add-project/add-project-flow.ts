/**
 * Pure state/derivation logic for the add-project dialog.
 *
 * The dialog drives four steps through a single text input, so "what does the
 * current text mean" is worth keeping out of the component and under test.
 */

import {
  buildGitHubCloneUrl,
  parseGitHubRepoInput,
  repoNameFromGitUrl,
  validateCloneRemoteUrl,
} from '@superone/shared/git-remote'
import {
  getBrowseLeafPathSegment,
  hasTrailingPathSeparator,
  isBareHomePath,
  isBrowseablePathQuery,
  joinBrowsePath,
  trimTrailingPathSeparators,
} from '@/lib/path-browse'

/** Where a project comes from. `local` never clones; the other two always do. */
export type AddProjectSource = 'local' | 'github' | 'url'

export type CloneSource = Exclude<AddProjectSource, 'local'>

export type AddProjectStep =
  /** Pick a source. */
  | { kind: 'source' }
  /** Browse the host filesystem and add an existing folder. */
  | { kind: 'browse' }
  /** Type `owner/repo` or a clone URL. */
  | { kind: 'repo'; source: CloneSource }
  /** Browse for the parent directory the repository is cloned into. */
  | {
      kind: 'destination'
      source: CloneSource
      repoInput: string
      remoteUrl: string
      repoName: string
    }

export const ADD_PROJECT_SOURCES: readonly AddProjectSource[] = ['local', 'github', 'url']

export interface ResolvedRepoInput {
  remoteUrl: string
  repoName: string
}

/**
 * Turn what the user typed into a clone URL plus the folder name it produces.
 * Returns null while the input is not yet a valid repository reference — the
 * dialog uses that to keep the submit action disabled.
 */
export function resolveRepoInput(source: CloneSource, raw: string): ResolvedRepoInput | null {
  const value = raw.trim()
  if (!value) return null

  if (source === 'github') {
    const ref = parseGitHubRepoInput(value)
    if (!ref) return null
    return { remoteUrl: buildGitHubCloneUrl(ref), repoName: ref.repo }
  }

  if (validateCloneRemoteUrl(value)) return null
  const repoName = repoNameFromGitUrl(value)
  if (!repoName) return null
  return { remoteUrl: value, repoName }
}

/**
 * Guess which source the text in the search box belongs to.
 *
 * Free typing on the source step only auto-matches local paths. GitHub and
 * Git URL require an explicit source pick — otherwise a half-typed URL or
 * `owner/repo` would yank the user out of path browsing.
 */
export function detectAddProjectSource(raw: string): AddProjectSource | null {
  const value = raw.trim()
  if (!value) return null
  if (isBrowseablePathQuery(value)) return 'local'
  return null
}

/**
 * When the source-step query is already a concrete path, jump into the folder
 * browser with the typed text carried over. GitHub / Git URL never auto-advance
 * from here — those sources are entered by clicking their rows.
 */
export function autoAdvanceFromSourceQuery(
  raw: string,
  initialPath: string,
): { step: AddProjectStep; query: string } | null {
  if (detectAddProjectSource(raw) !== 'local') return null
  const text = raw.trim()
  return { step: { kind: 'browse' }, query: text || initialPath }
}

/**
 * Extra hint shown on the detected row: what the input actually resolves to.
 * Null when the text already says it (a local path, an unparsable remote).
 */
export function describeDetectedSource(source: AddProjectSource, raw: string): string | null {
  if (source === 'local') return null
  const resolved = resolveRepoInput(source, raw)
  if (!resolved) return null
  // GitHub shorthand gains a real URL; a pasted URL gains the folder name.
  return source === 'github' ? resolved.remoteUrl : resolved.repoName
}

export interface ResolvedBrowsePath {
  /** Absolute path the current text points at ('' when there is no text). */
  path: string
  /** False when the directory does not exist yet — the caller offers to create it. */
  exists: boolean
}

/**
 * Resolve the typed path against the directory listing.
 *
 * Resolution goes through `listedPath` (the *absolute* path the host reported
 * for the listed directory) rather than the raw text, so a `~/`-prefixed query
 * still yields an absolute path the backend can act on.
 */
export function resolveBrowsePath(input: {
  query: string
  listedPath: string
  entries: ReadonlyArray<{ name: string; path: string }>
}): ResolvedBrowsePath {
  const trimmed = input.query.trim()
  if (!trimmed) return { path: '', exists: false }

  // Trailing slash *or* bare `~` means "this directory", not a child leaf.
  if (hasTrailingPathSeparator(trimmed) || isBareHomePath(trimmed)) {
    return input.listedPath
      ? { path: input.listedPath, exists: true }
      : { path: isBareHomePath(trimmed) ? '~' : trimTrailingPathSeparators(trimmed), exists: false }
  }

  const leaf = getBrowseLeafPathSegment(trimmed)
  const exact = input.entries.find((entry) => entry.name.toLowerCase() === leaf.toLowerCase())
  if (exact) return { path: exact.path, exists: true }
  if (input.listedPath && leaf) {
    return { path: joinBrowsePath(input.listedPath, leaf), exists: false }
  }
  return { path: trimTrailingPathSeparators(trimmed), exists: false }
}

/**
 * Which i18n key labels the primary action for the current step.
 *
 * Path steps keep a short stable label ("Add" / "Clone"); whether a missing
 * directory will be created is shown as a separate fixed-height hint, not by
 * lengthening the button text.
 */
export function submitLabelKey(step: AddProjectStep): string {
  switch (step.kind) {
    case 'source':
      return 'sidebar.addProject.actions.select'
    case 'repo':
      return 'sidebar.addProject.actions.continue'
    case 'browse':
      return 'sidebar.addProject.actions.add'
    case 'destination':
      return 'sidebar.addProject.actions.clone'
  }
}

/**
 * Electron wraps `ipcRenderer.invoke` failures as
 * `Error invoking remote method 'channel': Error: <actual>`. Strip that so the
 * dialog can show the underlying message (and match known clone failures).
 */
export function unwrapIpcInvokeError(message: string): string {
  const unwrapped = message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .trim()
  return unwrapped || message
}

/**
 * Turn a clone/open failure into the string shown under the add-project dialog.
 * Known cases get a localised, actionable sentence; everything else is the
 * unwrapped backend message.
 */
export function formatAddProjectError(
  err: unknown,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const raw = err instanceof Error ? err.message : String(err)
  const message = unwrapIpcInvokeError(raw)

  const existsMatch = message.match(/^destination already exists:\s*(.+)$/i)
  if (existsMatch?.[1]) {
    return t('sidebar.addProject.destinationExists', { path: existsMatch[1].trim() })
  }

  return message
}
