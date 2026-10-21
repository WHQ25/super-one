/**
 * `@session` mention grammar:
 *   session
 *   session <title query>
 *   session <project> <title query>
 *
 * The project step is optional. A first token followed by whitespace scopes
 * the search only when it equals a project label (case-insensitive); every
 * project with that label is in scope, so duplicate leaf names are not
 * ambiguous. Anything else is a title across every project on the host.
 *
 * Phases:
 *   recent — nothing to match yet (bare `@session`, or a scope with no title)
 *   search — a title, scoped or not
 *
 * While the first token is still being typed, `projectToken` feeds prefix
 * completion rows. Bare `@session` does not list projects.
 *
 * Internal mention kind is `session` (chip + send-message payload). The
 * user-facing portal keyword is also `session`.
 *
 * Everything here is pure. Listing sessions is host work.
 */

import { fuzzyMatch } from './fuzzy-match'
import { isGitMentionQuery, type GitMentionPortal } from './git-mention-query'

/** Navigate prefix when the user opens the Session built-in (trailing space for typing). */
export const SESSION_MENTION_NAV_PREFIX = 'session '

/** Portal keyword after `@` that enters session-archive mention mode. */
export const SESSION_MENTION_KEYWORD = 'session'

/** How many sessions the `@session` portal asks the host for. */
export const SESSION_MENTION_SEARCH_LIMIT = 50

export type SessionMentionPhase = 'recent' | 'search'

export interface ProjectOption {
  projectKey: string
  label: string
}

export interface ParsedSessionMentionQuery {
  phase: SessionMentionPhase
  /**
   * Every project whose label matched the scope token, or null when the
   * query is not scoped.
   */
  projects: ProjectOption[] | null
  /**
   * Partial first token while it can still complete to a project.
   * Empty once whitespace is typed, whether or not that token was a project.
   */
  projectToken: string
  /** Title after an optional scope. The whole rest when unscoped. */
  titleQuery: string
  /**
   * Prefix to navigate when completing a project scope, e.g. `session app `.
   * Null while unscoped.
   */
  scopeNavPrefix: string | null
}

/**
 * True when the @-query is in session mention mode (`session` or `session …`).
 * The keyword must follow `@` directly: `@ session` is prose, not a mention.
 */
export function isSessionMentionQuery(query: string): boolean {
  return new RegExp(`^${SESSION_MENTION_KEYWORD}(?:\\s|$)`, 'i').test(query)
}

/**
 * A composer closes the @ popup when the query contains a space, because file
 * and agent mentions are single tokens. The session and git grammars need
 * spaces, so this is the exemption list.
 */
export function mentionQueryAllowsSpaces(
  queryAfterAt: string,
  opts?: { gitPortals?: readonly GitMentionPortal[] },
): boolean {
  return isSessionMentionQuery(queryAfterAt) || isGitMentionQuery(queryAfterAt, opts?.gitPortals)
}

/** Argument grammar shown as ghost text. `[project]` is optional. */
export const SESSION_MENTION_ARGUMENT_HINT = '[project] <title>'

/**
 * Remaining ghost argument hint for `@session …` (without leading space).
 * Full hint while nothing is typed, `<title>` once a project scope is chosen
 * and the title is still empty, otherwise null.
 */
export function remainingSessionArgumentHint(
  queryAfterAt: string,
  projects: ProjectOption[] = [],
): string | null {
  const parsed = parseSessionMentionQuery(queryAfterAt, { projects })
  if (!parsed) return null
  if (parsed.projects && !parsed.titleQuery) return '<title>'
  if (!parsed.titleQuery && !parsed.projectToken) return SESSION_MENTION_ARGUMENT_HINT
  return null
}

/** Build project options for `@session` scope (recent folders + active project). */
export function buildSessionProjectOptions(
  recentFolders: Array<{ path: string; name?: string; missing?: boolean }>,
  activeProject: string | null | undefined,
): ProjectOption[] {
  const map = new Map<string, ProjectOption>()
  for (const f of recentFolders) {
    if (f.missing) continue
    map.set(f.path, {
      projectKey: f.path,
      label: f.name || f.path.split('/').filter(Boolean).pop() || f.path,
    })
  }
  if (activeProject && !map.has(activeProject)) {
    const label = activeProject.split('/').filter(Boolean).pop() || activeProject
    map.set(activeProject, { projectKey: activeProject, label })
  }
  return [...map.values()]
}

function projectsWithLabel(projects: ProjectOption[], token: string): ProjectOption[] {
  const needle = token.toLowerCase()
  return projects.filter((project) => project.label.toLowerCase() === needle)
}

export function parseSessionMentionQuery(
  query: string,
  opts: { projects?: ProjectOption[] } = {},
): ParsedSessionMentionQuery | null {
  if (!isSessionMentionQuery(query)) return null
  const projects = opts.projects ?? []
  const afterKeyword = query
    .replace(new RegExp(`^${SESSION_MENTION_KEYWORD}\\b`, 'i'), '')
    .trimStart()

  if (!afterKeyword.trim()) {
    return { phase: 'recent', projects: null, projectToken: '', titleQuery: '', scopeNavPrefix: null }
  }

  const sp = afterKeyword.search(/\s/)
  const first = (sp < 0 ? afterKeyword : afterKeyword.slice(0, sp)).trim()
  const rest = (sp < 0 ? '' : afterKeyword.slice(sp + 1)).trim()

  // A scope counts only once whitespace follows a label. `session app` is
  // still a title search, so Tab can complete the project.
  if (sp >= 0) {
    const matched = projectsWithLabel(projects, first)
    if (matched.length > 0) {
      const label = matched[0]!.label
      return {
        phase: rest ? 'search' : 'recent',
        projects: matched,
        projectToken: '',
        titleQuery: rest,
        scopeNavPrefix: `${SESSION_MENTION_KEYWORD} ${label} `,
      }
    }
  }

  return {
    phase: 'search',
    projects: null,
    projectToken: sp < 0 ? first : '',
    titleQuery: afterKeyword.trim(),
    scopeNavPrefix: null,
  }
}

/**
 * Project labels the user can Tab-complete while the first token is open.
 * Prefix only, current project first, one row per label.
 */
export function listSessionProjectCompletions(
  projects: ProjectOption[],
  projectToken: string,
  currentProjectKey: string | null,
): Array<{ token: string; label: string; hint: string; matchIndices: number[] }> {
  const token = projectToken.trim().toLowerCase()
  const byLabel = new Map<string, ProjectOption[]>()
  for (const project of projects) {
    const key = project.label.toLowerCase()
    if (token && !key.startsWith(token)) continue
    const group = byLabel.get(key)
    if (group) group.push(project)
    else byLabel.set(key, [project])
  }

  const rows = [...byLabel.values()].map((group) => {
    const current = group.find((project) => project.projectKey === currentProjectKey)
    const label = (current ?? group[0]!).label
    const hint = group.length === 1
      ? (group[0]!.projectKey === currentProjectKey ? 'current project' : group[0]!.projectKey)
      : (current ? 'current project' : '')
    return {
      token: label,
      label,
      hint,
      matchIndices: token ? Array.from({ length: token.length }, (_, i) => i) : [],
      current: Boolean(current),
    }
  })
  rows.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return rows.map(({ current: _current, ...row }) => row)
}

/** Title-only match for highlighting (same engine as file/agent mentions). */
export function titleMatches(title: string, query: string): boolean {
  if (!query.trim()) return true
  return fuzzyMatch(query.trim(), title || '').match
}

export function titleMatchIndices(title: string, query: string): number[] {
  const q = query.trim()
  if (!q) return []
  const r = fuzzyMatch(q, title || '')
  return r.match ? r.indices : []
}
