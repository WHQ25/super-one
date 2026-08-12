/**
 * @session mention query grammar (both project scope and title query required for search):
 *   session
 *   session <partial project|all>
 *   session <project|all> <title query>
 *
 * Phases:
 *   pick-project — choose `all` or a project (Tab-completable)
 *   need-title  — scope chosen; show recent sessions until title is typed
 *   search      — scope + title → filter sessions (title fuzzy match)
 *
 * Internal mention kind is `session` (chip + send-message payload).
 * User-facing portal keyword is also `session`.
 */

import type { SessionHistoryEntry } from '@superone/shared/agent-types'
import { listSessionsPage, sessionsPageHasMore } from '@/lib/session-list-ops'
import { fuzzyMatch } from '@/lib/fuzzy-match'

/** Navigate prefix when user opens the Session built-in (trailing space for typing). */
export const SESSION_MENTION_NAV_PREFIX = 'session '

/** Portal keyword after `@` that enters session-archive mention mode. */
export const SESSION_MENTION_KEYWORD = 'session'

export const SESSION_MENTION_PAGE_SIZE = 30
const TITLE_SCAN_PAGE = 50

export type SessionMentionScope =
  | { kind: 'all' }
  | { kind: 'project'; projectKey: string; label: string }

export type SessionMentionPhase = 'pick-project' | 'need-title' | 'search'

export interface ParsedSessionMentionQuery {
  phase: SessionMentionPhase
  /** Set once project/all is fully chosen. */
  scope: SessionMentionScope | null
  /** Partial first token while picking project (may be empty). */
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

/** True when @-query is in session mention mode (`session` or `session …`). */
export function isSessionMentionQuery(query: string): boolean {
  return new RegExp(`^${SESSION_MENTION_KEYWORD}(?:\\s|$)`, 'i').test(query.trimStart())
}

/**
 * ChatInput closes the @ popup when the query contains a space (file/agent
 * mentions are single tokens). Session grammar needs spaces.
 */
export function mentionQueryAllowsSpaces(queryAfterAt: string): boolean {
  return isSessionMentionQuery(queryAfterAt)
}

/** Argument grammar shown as ghost text (same style as slash `argumentHint`). */
export const SESSION_MENTION_ARGUMENT_HINT = '<project | all> <title>'

/**
 * Remaining ghost argument hint for `@session …` (without leading space).
 * Returns null when nothing left to show (search phase / fully filled).
 *
 * Pass the same project options used by the popup so an exact project label
 * advances to need-title (otherwise ghost stays on full grammar forever).
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
  // search: user is already typing the freeform title
  return null
}

/** Build project options for @session scope (recent folders + active project). */
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

  // Still typing project token (no space after first word) → project picker.
  if (!hasSpaceAfterFirst) {
    return {
      phase: 'pick-project',
      scope: null,
      projectToken: first,
      titleQuery: '',
      scopeNavPrefix: null,
    }
  }

  // Space after first token → first must be `all` or an exact project label.
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

  // Unknown project token after space — keep filtering projects by that token.
  return {
    phase: 'pick-project',
    scope: null,
    projectToken: first,
    titleQuery: '',
    scopeNavPrefix: null,
  }
}

/** Projects (+ synthetic `all`) to show while picking scope. */
export function listSessionProjectChoices(
  projects: ProjectOption[],
  projectToken: string,
  currentProjectKey: string | null,
): Array<{ token: string; label: string; hint: string; matchIndices: number[] }> {
  const token = projectToken.trim().toLowerCase()
  const choices: Array<{ token: string; label: string; hint: string; matchIndices: number[] }> = []

  // Match on token "all" or display phrase "All Projects"
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

function matchProjectTokenExact(token: string, projects: ProjectOption[]): ProjectOption | null {
  const t = token.toLowerCase()
  if (!t) return null
  return projects.find((p) => p.label.toLowerCase() === t) ?? null
}

/** Title-only match for @session search (fuzzy, same engine as file/agent mentions). */
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

function scopeProjectKeys(
  scope: SessionMentionScope,
  allProjects: ProjectOption[],
): ProjectOption[] {
  if (scope.kind === 'all') return allProjects.length > 0 ? allProjects : []
  return [{ projectKey: scope.projectKey, label: scope.label }]
}

/**
 * Load the next page of sessions for the mention popup.
 * - Empty titleQuery → recency order (no filter), for need-title “Recent”.
 * - Non-empty titleQuery → keep only title fuzzy matches (may over-scan pages).
 */
export async function loadSessionMentionPage(args: {
  scope: SessionMentionScope
  titleQuery: string
  projects: ProjectOption[]
  state: SessionMentionLoadState
  pageSize?: number
}): Promise<{ rows: SessionMentionRow[]; next: SessionMentionLoadState }> {
  const pageSize = args.pageSize ?? SESSION_MENTION_PAGE_SIZE
  const projectList = scopeProjectKeys(args.scope, args.projects)
  if (projectList.length === 0) {
    return { rows: [], next: { offset: 0, projectIndex: 0, hasMore: false } }
  }

  const titleQ = args.titleQuery.trim()
  // Recency list can use pageSize directly; title search may skip rows so over-fetch.
  const fetchLimit = titleQ ? TITLE_SCAN_PAGE : pageSize

  let { offset, projectIndex } = args.state
  const rows: SessionMentionRow[] = []

  while (projectIndex < projectList.length && rows.length < pageSize) {
    const proj = projectList[projectIndex]
    const page = await listSessionsPage(proj.projectKey, {
      limit: fetchLimit,
      offset,
    })

    if (page.length === 0) {
      projectIndex += 1
      offset = 0
      continue
    }

    for (let i = 0; i < page.length; i++) {
      const session = page[i]
      // Empty titleQ → titleMatches is always true (recent dump).
      if (!titleMatches(session.title || '', titleQ)) continue
      rows.push({ session, projectKey: proj.projectKey, projectLabel: proj.label })
      if (rows.length >= pageSize) {
        const nextOffset = offset + i + 1
        const moreInPage = i + 1 < page.length
        const moreInProject = moreInPage || sessionsPageHasMore(page, fetchLimit)
        if (moreInProject) {
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
    if (!sessionsPageHasMore(page, fetchLimit)) {
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
