import type { GithubRepoHit } from '@superone/shared/agent-types'
import {
  ADD_PROJECT_SOURCES,
  describeDetectedSource,
  type AddProjectSource,
  type AddProjectStep,
} from '@superone/shared/add-project-flow'
import { githubOwnerAvatarUrl } from '@superone/shared/git-remote'
import { fuzzyMatch } from './slash'

/**
 * Copy taken verbatim from the desktop `sidebar.addProject` strings so the two
 * surfaces read identically. The shell has no i18n runtime yet; when it gains
 * one this table is what gets replaced.
 */
export const ADD_PROJECT_TEXT = {
  sources: 'Sources',
  projects: 'Projects',
  searchPlaceholder: 'Type a path, or pick a source...',
  pathPlaceholder: '~/Projects/',
  repoPlaceholderGithub: 'Name, owner/repo, or GitHub URL',
  repoPlaceholderUrl: 'https://github.com/owner/repo.git',
  destinationPlaceholder: 'Where should it be cloned?',
  repository: 'Repository',
  repoInvalidGithub: 'Type owner/ to search, or paste a GitHub URL.',
  repoInvalidUrl: 'Enter an https, ssh or git clone URL.',
  githubRepos: 'Repositories',
  githubYourRepos: 'Your Repositories',
  githubSearchResults: 'Search Results',
  githubSearching: 'Searching',
  githubNoRepos: 'No Repositories Matched.',
  githubNeedCli: 'Install and sign in to GitHub CLI (gh) to list your repos, or type owner/repo.',
  githubPrivate: 'Private',
  clonesInto: 'Clones into {{path}}',
  cloning: 'Cloning...',
  createSection: 'Create',
  createDirectory: 'Create Directory',
  shallowClone: 'Shallow Clone (--depth=1)',
  pathRequired: 'Enter a project path.',
  directories: 'Directories',
  noDirectories: 'No directories here.',
  noProjects: 'No projects yet',
  loading: 'Loading…',
} as const

const SOURCE_COPY: Record<AddProjectSource, { label: string; hint: string }> = {
  local: { label: 'Local Folder', hint: 'Open or create a folder on this machine.' },
  github: { label: 'GitHub Repository', hint: 'Search by name, owner/repo, or paste a GitHub URL.' },
  url: { label: 'Git URL', hint: 'Clone from any git remote.' },
}

export type AddProjectRowIcon = AddProjectSource | 'directory' | 'create' | 'project'

export interface AddProjectRow {
  key: string
  icon: AddProjectRowIcon
  label: string
  /** Fuzzy-match positions to highlight, as produced by `fuzzyMatch`. */
  matchIndices?: number[]
  /** Trailing muted text (directory hints, repo descriptions). */
  hint?: string
  /** Second line under the title (source picker, repository rows). */
  subtitle?: string
  stars?: number | null
  /** Owner avatar for a repository row. */
  avatarUrl?: string
  /** Show the whole label, wrapped — the create-missing-path row needs it. */
  wrapLabel?: boolean
  /** Taller row with a larger glyph, used by the source picker. */
  prominent?: boolean
}

export interface AddProjectSectionModel {
  key: string
  label: string
  rows: AddProjectRow[]
  /** Append the cycling ellipsis instead of a count. */
  searching?: boolean
  icon?: 'search' | 'user'
}

/** Page title for the current step — same wording as the desktop dialog. */
export function addProjectStepTitle(step: AddProjectStep): string {
  switch (step.kind) {
    case 'source': return 'Add Project'
    case 'browse': return 'Open or Create a Folder'
    case 'repo': return step.source === 'github' ? 'Search GitHub' : 'Enter a Git URL'
    case 'destination': return 'Choose Clone Location'
  }
}

export function addProjectPlaceholder(step: AddProjectStep): string {
  switch (step.kind) {
    case 'source': return ADD_PROJECT_TEXT.searchPlaceholder
    case 'browse': return ADD_PROJECT_TEXT.pathPlaceholder
    case 'repo':
      return step.source === 'github'
        ? ADD_PROJECT_TEXT.repoPlaceholderGithub
        : ADD_PROJECT_TEXT.repoPlaceholderUrl
    case 'destination': return ADD_PROJECT_TEXT.destinationPlaceholder
  }
}

/**
 * The three sources. A recognised path floats `local` to the top and shows what
 * the text resolves to; anything else that looks like content (a slash, a URL)
 * keeps every source visible so GitHub / Git URL stay one tap away.
 */
export function sourceRows(query: string, detected: AddProjectSource | null): AddProjectRow[] {
  const toRow = (source: AddProjectSource, matchIndices: number[] = [], subtitle?: string): AddProjectRow => ({
    key: source,
    icon: source,
    label: SOURCE_COPY[source].label,
    matchIndices,
    prominent: true,
    subtitle: subtitle ?? SOURCE_COPY[source].hint,
  })

  if (detected) {
    return [...ADD_PROJECT_SOURCES]
      .sort((a, b) => Number(b === detected) - Number(a === detected))
      .map((source) => toRow(
        source,
        [],
        source === detected ? describeDetectedSource(source, query) ?? undefined : undefined,
      ))
  }

  const filter = query.trim().toLowerCase()
  const looksLikeContent = !filter
    || /[/\\:@]/.test(filter)
    || filter.startsWith('~')
    || filter.startsWith('.')
  if (looksLikeContent) return ADD_PROJECT_SOURCES.map((source) => toRow(source))

  return ADD_PROJECT_SOURCES
    .map((source) => ({ source, match: fuzzyMatch(filter, SOURCE_COPY[source].label) }))
    .filter(({ match }) => match.match)
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ source, match }) => toRow(source, match.indices))
}

/**
 * Already-open projects, ranked by the same fuzzy match the sources use. This
 * section has no desktop counterpart in the dialog — on the phone the picker
 * and the sidebar list are one screen.
 */
export function projectRows(
  projects: ReadonlyArray<{ path: string; name: string }>,
  query: string,
): AddProjectRow[] {
  const filter = query.trim().toLowerCase()
  if (!filter) {
    return projects.map((project) => ({
      key: project.path, icon: 'project', label: project.name, subtitle: project.path,
    }))
  }
  return projects
    .map((project) => ({ project, match: fuzzyMatch(filter, project.name) }))
    .filter(({ match }) => match.match)
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ project, match }) => ({
      key: project.path,
      icon: 'project' as const,
      label: project.name,
      matchIndices: match.indices,
      subtitle: project.path,
    }))
}

/**
 * Child directories of the listed folder. Rows are keyed by name, not by
 * absolute path: tapping one appends that segment to whatever prefix the user
 * typed, so `~/Dev` stays `~/Dev`.
 */
export function directoryRows(
  entries: ReadonlyArray<{ name: string }>,
  leafPartial: string,
): AddProjectRow[] {
  if (!leafPartial) {
    return entries.map((entry) => ({ key: entry.name, icon: 'directory', label: entry.name }))
  }
  return entries
    .map((entry) => ({ entry, match: fuzzyMatch(leafPartial.toLowerCase(), entry.name) }))
    .filter(({ match }) => match.match)
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ entry, match }) => ({
      key: entry.name, icon: 'directory' as const, label: entry.name, matchIndices: match.indices,
    }))
}

function repoRow(repo: GithubRepoHit, matchIndices: number[]): AddProjectRow {
  return {
    key: repo.fullName,
    icon: 'github',
    label: repo.fullName,
    matchIndices,
    subtitle: repo.description ?? (repo.private ? ADD_PROJECT_TEXT.githubPrivate : ''),
    stars: repo.stars,
    avatarUrl: githubOwnerAvatarUrl(repo.owner, 80),
  }
}

/**
 * Repository rows for the GitHub step.
 *
 * `ownerPrefix` is set while the query is `owner/partial` — matching then runs
 * against `owner/name`, because the typed text carries the owner segment. With
 * no owner the list is the signed-in user's repos filtered by the bare query,
 * which matches on the repo name alone unless a slash was typed.
 */
export function githubRows(
  repos: readonly GithubRepoHit[],
  input: { ownerPrefix?: { owner: string; repoPrefix: string } | null; query?: string },
): AddProjectRow[] {
  const owner = input.ownerPrefix
  const filter = (owner ? owner.repoPrefix : input.query ?? '').trim().toLowerCase()
  const limit = owner ? 50 : 200
  return repos
    .map((repo) => {
      const haystack = owner || filter.includes('/') ? repo.fullName : repo.name
      const match = filter ? fuzzyMatch(filter, haystack) : { match: true, score: 0, indices: [] }
      // Highlight against fullName so the owner segment lights up too.
      const highlight = owner
        ? (owner.repoPrefix ? `${owner.owner}/${owner.repoPrefix}` : owner.owner)
        : filter.includes('/') ? '' : filter
      const labelMatch = highlight ? fuzzyMatch(highlight.toLowerCase(), repo.fullName) : match
      return { repo, match, labelMatch }
    })
    .filter(({ match }) => match.match)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, limit)
    .map(({ repo, labelMatch }) => repoRow(repo, labelMatch.indices))
}

/** Search-API hits, minus the repositories already listed as the user's own. */
export function githubSearchRows(
  hits: readonly GithubRepoHit[],
  mine: readonly GithubRepoHit[],
  query: string,
): AddProjectRow[] {
  const owned = new Set(mine.map((repo) => repo.fullName.toLowerCase()))
  const filter = query.trim().toLowerCase()
  return hits
    .filter((repo) => !owned.has(repo.fullName.toLowerCase()))
    .map((repo) => repoRow(repo, fuzzyMatch(filter, repo.fullName).indices))
}
