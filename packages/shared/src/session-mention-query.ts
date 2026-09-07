/**
 * `@session` mention grammar (both project scope and title query required for search):
 *   session
 *   session <partial project|all>
 *   session <project|all> <title query>
 *
 * Phases:
 *   pick-project — choose `all` or a project (Tab-completable)
 *   need-title   — scope chosen; show recent sessions until a title is typed
 *   search       — scope + title → filter sessions (title fuzzy match)
 *
 * Internal mention kind is `session` (chip + send-message payload). The
 * user-facing portal keyword is also `session`.
 *
 * Everything here is pure. Paging is driven through an injected
 * `SessionMentionPageLoader` because the two apps fetch differently — the
 * desktop goes through `window.environment`, a remote client through the
 * `list_sessions` RPC — while the scan/filter algorithm is the same.
 */

import type { SessionHistoryEntry } from './agent-types'
import { fuzzyMatch } from './fuzzy-match'

/** Navigate prefix when the user opens the Session built-in (trailing space for typing). */
export const SESSION_MENTION_NAV_PREFIX = 'session '

/** Portal keyword after `@` that enters session-archive mention mode. */
export const SESSION_MENTION_KEYWORD = 'session'

export const SESSION_MENTION_PAGE_SIZE = 30

/** Title search may skip most of a page, so it over-fetches. */
const TITLE_SCAN_PAGE = 50

export type SessionMentionScope =
  | { kind: 'all' }
  | { kind: 'project'; projectKey: string; label: string }

export type SessionMentionPhase = 'pick-project' | 'need-title' | 'search'

export interface ParsedSessionMentionQuery {
  phase: SessionMentionPhase
  /** Set once project/all is fully chosen. */
  scope: SessionMentionScope | null
  /** Partial first token while picking a project (may be empty). */
  projectToken: string
  titleQuery: string
  /**
   * Prefix to navigate when completing a project scope, e.g. `session all `
   * or `session super-one `.
   */
  scopeNavPrefix: string | null
}

export interface ProjectOption {
  projectKey: string
  label: string
}

/** True when the @-query is in session mention mode (`session` or `session …`). */
export function isSessionMentionQuery(query: string): boolean {
  return new RegExp(`^${SESSION_MENTION_KEYWORD}(?:\\s|$)`, 'i').test(query.trimStart())
}

/**
 * A composer closes the @ popup when the query contains a space, because file
 * and agent mentions are single tokens. Session grammar needs spaces, so this
 * is the exemption.
 */
export function mentionQueryAllowsSpaces(queryAfterAt: string): boolean {
  return isSessionMentionQuery(queryAfterAt)
}

/** Argument grammar shown as ghost text (same style as a slash `argumentHint`). */
export const SESSION_MENTION_ARGUMENT_HINT = '<project | all> <title>'

/**
 * Remaining ghost argument hint for `@session …` (without leading space).
 * Returns null when there is nothing left to show (search phase / fully filled).
 *
 * Pass the same project options the popup uses, so an exact project label
 * advances to need-title — otherwise the ghost stays on the full grammar.
 */
export function remainingSessionArgumentHint(
  queryAfterAt: string,
  projects: ProjectOption[] = [],
): string | null {
  const parsed = parseSessionMentionQuery(queryAfterAt, {
    currentProjectKey: null,
    projects,
  })
  if (!parsed) return null
  if (parsed.phase === 'pick-project') return SESSION_MENTION_ARGUMENT_HINT
  if (parsed.phase === 'need-title') return '<title>'
  // search: the user is already typing the freeform title
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

export function parseSessionMentionQuery(
  query: string,
  opts: {
    currentProjectKey: string | null
    projects: ProjectOption[]
  },
): ParsedSessionMentionQuery | null {
  const trimmed = query.trimStart()
  if (!isSessionMentionQuery(trimmed)) return null

  const afterTrimStart = trimmed
    .replace(new RegExp(`^${SESSION_MENTION_KEYWORD}\\b`, 'i'), '')
    .trimStart()

  if (!afterTrimStart) {
    return {
      phase: 'pick-project',
      scope: null,
      projectToken: '',
      titleQuery: '',
      scopeNavPrefix: null,
    }
  }

  const sp = afterTrimStart.search(/\s/)
  const first = (sp < 0 ? afterTrimStart : afterTrimStart.slice(0, sp)).trim()
  const hasSpaceAfterFirst = sp >= 0
  const rest = (sp < 0 ? '' : afterTrimStart.slice(sp + 1)).trim()

  // Still typing the project token (no space after the first word) → picker.
  if (!hasSpaceAfterFirst) {
    return {
      phase: 'pick-project',
      scope: null,
      projectToken: first,
      titleQuery: '',
      scopeNavPrefix: null,
    }
  }

  // Space after the first token → it must be `all` or an exact project label.
  if (first.toLowerCase() === 'all') {
    return {
      phase: rest ? 'search' : 'need-title',
      scope: { kind: 'all' },
      projectToken: 'all',
      titleQuery: rest,
      scopeNavPrefix: `${SESSION_MENTION_KEYWORD} all `,
    }
  }

  const exact = matchProjectTokenExact(first, opts.projects)
  if (exact) {
    return {
      phase: rest ? 'search' : 'need-title',
      scope: { kind: 'project', projectKey: exact.projectKey, label: exact.label },
      projectToken: exact.label,
      titleQuery: rest,
      scopeNavPrefix: `${SESSION_MENTION_KEYWORD} ${exact.label} `,
    }
  }

  // Unknown project token after a space — keep filtering projects by it.
  return {
    phase: 'pick-project',
    scope: null,
    projectToken: first,
    titleQuery: '',
    scopeNavPrefix: null,
  }
}

/** Projects (+ the synthetic `all`) to show while picking scope. */
export function listSessionProjectChoices(
  projects: ProjectOption[],
  projectToken: string,
  currentProjectKey: string | null,
): Array<{ token: string; label: string; hint: string; matchIndices: number[] }> {
  const token = projectToken.trim().toLowerCase()
  const choices: Array<{ token: string; label: string; hint: string; matchIndices: number[] }> = []

  // Match on the token "all" or the display phrase "All Projects".
  const allIndices =
    token
      ? (fuzzyIndices('all', token) ?? fuzzyIndices('all projects', token))
      : []
  if (!token || allIndices) {
    choices.push({
      token: 'all',
      label: 'All Projects',
      hint: 'all projects',
      matchIndices: allIndices ?? [],
    })
  }

  const sorted = [...projects].sort((a, b) => {
    if (a.projectKey === currentProjectKey) return -1
    if (b.projectKey === currentProjectKey) return 1
    return a.label.localeCompare(b.label)
  })

  for (const p of sorted) {
    const indices = token ? fuzzyIndices(p.label, token) : []
    if (token && !indices) continue
    choices.push({
      token: p.label,
      label: p.label,
      hint: p.projectKey === currentProjectKey ? 'current project' : p.projectKey,
      matchIndices: indices ?? [],
    })
  }
  return choices
}

function fuzzyIndices(text: string, query: string): number[] | null {
  if (!query) return []
  const tLow = text.toLowerCase()
  const qLow = query.toLowerCase()
  const idx = tLow.indexOf(qLow)
  if (idx < 0) return null
  const indices: number[] = []
  for (let i = 0; i < qLow.length; i++) indices.push(idx + i)
  return indices
}

/**
 * The scope token is resolved by **display label**, so the grammar is ambiguous
 * for two projects whose leaf directory name matches, for a label containing a
 * space (the parser splits on the first one), and for a project literally named
 * `all`. Behaviour is pinned by tests rather than fixed: the fix is a stable
 * `projectKey` selection state or quoting, and it belongs with the popup that
 * would offer the disambiguation, not here.
 */
function matchProjectTokenExact(token: string, projects: ProjectOption[]): ProjectOption | null {
  const t = token.toLowerCase()
  if (!t) return null
  return projects.find((p) => p.label.toLowerCase() === t) ?? null
}

/** Title-only match for `@session` search (same engine as file/agent mentions). */
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

export interface SessionMentionRow {
  session: SessionHistoryEntry
  projectKey: string
  projectLabel: string
}

export interface SessionMentionLoadState {
  offset: number
  projectIndex: number
  hasMore: boolean
}

export function initialSessionMentionLoadState(): SessionMentionLoadState {
  return { offset: 0, projectIndex: 0, hasMore: true }
}

/**
 * Fetch one page for one project.
 *
 * `hasMore` is reported by the loader rather than inferred from
 * `sessions.length >= limit`, so a backend that knows the total does not have
 * to fake a full page to say "keep going".
 */
export type SessionMentionPageLoader = (
  projectKey: string,
  limit: number,
  offset: number,
) => Promise<{ sessions: SessionHistoryEntry[]; hasMore: boolean }>

function scopeProjectKeys(
  scope: SessionMentionScope,
  allProjects: ProjectOption[],
): ProjectOption[] {
  if (scope.kind === 'all') return allProjects.length > 0 ? allProjects : []
  return [{ projectKey: scope.projectKey, label: scope.label }]
}

/**
 * Load the next page of sessions for the mention popup.
 *
 * - Empty titleQuery → recency order, no filter (the need-title "Recent" list).
 * - Non-empty titleQuery → keep only title fuzzy matches, which means scanning
 *   past rows that do not match and possibly crossing several pages.
 */
export async function loadSessionMentionPage(args: {
  scope: SessionMentionScope
  titleQuery: string
  projects: ProjectOption[]
  state: SessionMentionLoadState
  loadPage: SessionMentionPageLoader
  pageSize?: number
}): Promise<{ rows: SessionMentionRow[]; next: SessionMentionLoadState }> {
  const pageSize = args.pageSize ?? SESSION_MENTION_PAGE_SIZE
  const projectList = scopeProjectKeys(args.scope, args.projects)
  if (projectList.length === 0) {
    return { rows: [], next: { offset: 0, projectIndex: 0, hasMore: false } }
  }

  const titleQ = args.titleQuery.trim()
  const fetchLimit = titleQ ? TITLE_SCAN_PAGE : pageSize

  let { offset, projectIndex } = args.state
  const rows: SessionMentionRow[] = []

  while (projectIndex < projectList.length && rows.length < pageSize) {
    const proj = projectList[projectIndex]!
    const { sessions: page, hasMore: moreInProject } = await args.loadPage(
      proj.projectKey,
      fetchLimit,
      offset,
    )

    if (page.length === 0) {
      projectIndex += 1
      offset = 0
      continue
    }

    for (let i = 0; i < page.length; i++) {
      const session = page[i]!
      // Empty titleQ → titleMatches is always true (recent dump).
      if (!titleMatches(session.title || '', titleQ)) continue
      rows.push({ session, projectKey: proj.projectKey, projectLabel: proj.label })
      if (rows.length >= pageSize) {
        const nextOffset = offset + i + 1
        const moreInPage = i + 1 < page.length
        if (moreInPage || moreInProject) {
          return {
            rows,
            next: { offset: nextOffset, projectIndex, hasMore: true },
          }
        }
        return {
          rows,
          next: {
            offset: 0,
            projectIndex: projectIndex + 1,
            hasMore: projectIndex + 1 < projectList.length,
          },
        }
      }
    }

    offset += page.length
    if (!moreInProject) {
      projectIndex += 1
      offset = 0
    }
  }

  return {
    rows,
    next: {
      offset,
      projectIndex,
      hasMore: projectIndex < projectList.length,
    },
  }
}
