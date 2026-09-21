/**
 * `@git` and `@gh` mention grammar (mirrors `@session`):
 *   git                          gh
 *   git <branch|commit|worktree|tag>   gh <issue|pr>
 *   git <kind> <query>           gh <kind> <number | query>
 *
 * Two portals, one grammar: `@git` browses the repository, `@gh` asks GitHub
 * through the `gh` CLI. Both produce the same `git` mention kind, so chips,
 * tags and the phone pipeline are shared; only the entry row and the host
 * lookup differ.
 *
 * Phases:
 *   pick-kind  — choose which ref kind to browse (Tab-completable)
 *   need-query — kind chosen; show the default list until a query is typed
 *   search     — kind + query → host-side filter
 *
 * Internal mention kind is `git`; the chip value encodes the ref kind with the
 * exact identifier (`branch:main`, `commit:<full sha>`, `worktree:<path>`,
 * `tag:v1.0`) so the agent never has to guess what a label meant. Hosted
 * kinds also carry where they live (`issue:github:123`, `pr:github:45`): the
 * number alone is meaningless once another forge is supported.
 *
 * Everything here is pure. Listing refs is host work (desktop main, remote
 * node, or the paired desktop for a phone) behind `GitMentionRefsResult`.
 */

import { fuzzyMatch } from './fuzzy-match'

export const GIT_MENTION_REF_KINDS = ['branch', 'commit', 'worktree', 'tag', 'issue', 'pr'] as const
export type GitMentionRefKind = (typeof GIT_MENTION_REF_KINDS)[number]

export type GitMentionPortal = 'git' | 'gh'

/** Which portal keyword offers which kinds. */
export const GIT_MENTION_PORTALS: Record<GitMentionPortal, readonly GitMentionRefKind[]> = {
  git: ['branch', 'commit', 'worktree', 'tag'],
  gh: ['issue', 'pr'],
}

/** Portal keyword after `@` that enters repository ref mention mode. */
export const GIT_MENTION_KEYWORD: GitMentionPortal = 'git'
/** Portal keyword after `@` that enters GitHub issue / PR mention mode. */
export const GH_MENTION_KEYWORD: GitMentionPortal = 'gh'

/** Navigate prefix when the user opens a portal built-in (trailing space for typing). */
export const GIT_MENTION_NAV_PREFIX = `${GIT_MENTION_KEYWORD} `
export const GH_MENTION_NAV_PREFIX = `${GH_MENTION_KEYWORD} `

export function gitMentionPortalOf(kind: GitMentionRefKind): GitMentionPortal {
  return GIT_MENTION_PORTALS.gh.includes(kind) ? 'gh' : 'git'
}

export type GitHubRefKind = 'issue' | 'pr'

/** Where a hosted item (issue, PR) lives. Only GitHub today; the value is on the wire, so add, never rename. */
export type GitHostProvider = 'github'
export const GIT_HOST_PROVIDERS: readonly GitHostProvider[] = ['github']

export function isGitHostProvider(value: unknown): value is GitHostProvider {
  return typeof value === 'string' && (GIT_HOST_PROVIDERS as readonly string[]).includes(value)
}

/** Kinds that live on GitHub rather than in the repository. */
export function isGitHubRefKind(kind: GitMentionRefKind): kind is GitHubRefKind {
  return gitMentionPortalOf(kind) === 'gh'
}

/**
 * What a host can list for a cwd. `github` means `gh` is installed, signed in,
 * and the repository has a GitHub remote — the three things `gh issue list`
 * needs, probed as one `gh repo view`.
 */
export interface GitMentionCapabilities {
  repo: 'ready' | 'not-repo' | 'unsupported'
  github: boolean
}

export const GIT_MENTION_CAPABILITIES_UNKNOWN: GitMentionCapabilities = { repo: 'unsupported', github: false }

export function parseGitMentionCapabilities(raw: unknown): GitMentionCapabilities | null {
  const v = raw as Partial<GitMentionCapabilities> | null | undefined
  if (!v || typeof v !== 'object') return null
  if (v.repo !== 'ready' && v.repo !== 'not-repo' && v.repo !== 'unsupported') return null
  return { repo: v.repo, github: v.github === true }
}

/** Rows per kind the host returns; a query narrows within the same cap. */
export const GIT_MENTION_REF_LIMIT = 50

export const SHORT_SHA_LENGTH = 7

export type GitMentionPhase = 'pick-kind' | 'need-query' | 'search'

export interface ParsedGitMentionQuery {
  /** Which keyword the user typed; decides the kinds offered and the host lookup. */
  portal: GitMentionPortal
  phase: GitMentionPhase
  /** Set once a ref kind is fully chosen. */
  refKind: GitMentionRefKind | null
  /** Partial first token while picking a kind (may be empty). */
  kindToken: string
  refQuery: string
  /** Prefix to navigate when completing a kind, e.g. `git branch `. */
  kindNavPrefix: string | null
}

export type GitHubItemState = 'open' | 'closed' | 'merged' | 'draft'

/** One selectable ref, already shaped for a popup row. */
export interface GitMentionRef {
  kind: GitMentionRefKind
  /** Exact identifier: branch name, full sha, worktree path, tag name, issue / PR number. */
  id: string
  /** Row label: branch name, short sha, worktree branch, tag name, `#number`. */
  label: string
  /** Quiet text beside the label: commit subject, a worktree's path, an issue / PR title. */
  detail: string
  /** ISO timestamp of the tip commit or last update, when the host reported one. */
  date?: string
  /** Commit author / issue author login. */
  author?: string
  /** Checked out here (branch) / the checkout we are in (worktree). */
  current?: boolean
  /** Issue / PR lifecycle (hosted kinds only). */
  state?: GitHubItemState
  /** Which forge a hosted item came from (hosted kinds only). */
  host?: GitHostProvider
}

export type GitMentionRefsUnavailable = 'not-repo' | 'unsupported' | 'error' | 'gh-unavailable'

export type GitMentionRefsResult =
  | { ok: true; refs: GitMentionRef[] }
  | { ok: false; reason: GitMentionRefsUnavailable; error?: string }

export function isGitMentionRefKind(value: unknown): value is GitMentionRefKind {
  return typeof value === 'string' && (GIT_MENTION_REF_KINDS as readonly string[]).includes(value)
}

export const ALL_GIT_MENTION_PORTALS: readonly GitMentionPortal[] = ['git', 'gh']

/**
 * Portals a host can serve, from its capability probe. A portal that is off
 * must not own the grammar either: `@gh foo` on a machine without `gh` is
 * plain text, not a mention that then apologises. Unknown (probe pending)
 * keeps every portal on, so the first keystrokes are not mis-typed.
 */
export function enabledGitMentionPortals(caps: GitMentionCapabilities | null | undefined): readonly GitMentionPortal[] {
  if (!caps || caps.repo === 'unsupported') return ALL_GIT_MENTION_PORTALS
  if (caps.repo !== 'ready') return []
  return caps.github ? ALL_GIT_MENTION_PORTALS : ['git']
}

/** The portal keyword a query opens with, if any. `@ git` is prose, not a mention. */
export function gitMentionPortalOfQuery(
  query: string,
  portals: readonly GitMentionPortal[] = ALL_GIT_MENTION_PORTALS,
): GitMentionPortal | null {
  for (const portal of portals) {
    if (new RegExp(`^${portal}(?:\\s|$)`, 'i').test(query)) return portal
  }
  return null
}

/** True when the @-query is in `@git …` or `@gh …` mention mode (for a portal that is on). */
export function isGitMentionQuery(query: string, portals?: readonly GitMentionPortal[]): boolean {
  return gitMentionPortalOfQuery(query, portals) !== null
}

/** Argument grammar shown as ghost text (same style as a slash `argumentHint`). */
export function gitMentionArgumentHint(portal: GitMentionPortal): string {
  const kinds = GIT_MENTION_PORTALS[portal]
  return portal === 'gh' ? `<${kinds.join(' | ')}> <number | query>` : `<${kinds.join(' | ')}> <query>`
}

/**
 * Remaining ghost argument hint for `@git …` / `@gh …` (without leading space).
 * Returns null when there is nothing left to show (search phase).
 */
export function remainingGitArgumentHint(
  queryAfterAt: string,
  portals?: readonly GitMentionPortal[],
): string | null {
  const parsed = parseGitMentionQuery(queryAfterAt, portals)
  if (!parsed) return null
  if (parsed.phase === 'pick-kind') return gitMentionArgumentHint(parsed.portal)
  if (parsed.phase === 'need-query') return parsed.portal === 'gh' ? '<number | query>' : '<query>'
  return null
}

export function parseGitMentionQuery(
  query: string,
  portals?: readonly GitMentionPortal[],
): ParsedGitMentionQuery | null {
  const portal = gitMentionPortalOfQuery(query, portals)
  if (!portal) return null

  const afterKeyword = query
    .replace(new RegExp(`^${portal}\\b`, 'i'), '')
    .trimStart()

  if (!afterKeyword) {
    return { portal, phase: 'pick-kind', refKind: null, kindToken: '', refQuery: '', kindNavPrefix: null }
  }

  const sp = afterKeyword.search(/\s/)
  const first = (sp < 0 ? afterKeyword : afterKeyword.slice(0, sp)).trim()
  const rest = (sp < 0 ? '' : afterKeyword.slice(sp + 1)).trim()

  // Still typing the kind token (no space after the first word) → picker.
  if (sp < 0) {
    return { portal, phase: 'pick-kind', refKind: null, kindToken: first, refQuery: '', kindNavPrefix: null }
  }

  const refKind = first.toLowerCase()
  if (!isGitMentionRefKind(refKind) || gitMentionPortalOf(refKind) !== portal) {
    // Unknown kind (or one the other portal owns) after a space — keep filtering kinds by it.
    return { portal, phase: 'pick-kind', refKind: null, kindToken: first, refQuery: '', kindNavPrefix: null }
  }

  return {
    portal,
    phase: rest ? 'search' : 'need-query',
    refKind,
    kindToken: refKind,
    refQuery: rest,
    kindNavPrefix: `${portal} ${refKind} `,
  }
}

/** Ref kinds to show while picking, filtered by the partial token. */
export function listGitRefKindChoices(
  portal: GitMentionPortal,
  kindToken: string,
): Array<{ kind: GitMentionRefKind; matchIndices: number[] }> {
  const token = kindToken.trim().toLowerCase()
  const choices: Array<{ kind: GitMentionRefKind; matchIndices: number[] }> = []
  for (const kind of GIT_MENTION_PORTALS[portal]) {
    const idx = token ? kind.indexOf(token) : 0
    if (idx < 0) continue
    choices.push({
      kind,
      matchIndices: token ? Array.from({ length: token.length }, (_, i) => idx + i) : [],
    })
  }
  return choices
}

export interface GitMentionValue {
  kind: GitMentionRefKind
  id: string
  /** Present for hosted kinds. */
  host?: GitHostProvider
}

/** Chip / send-message value: `<kind>:<id>`, or `<kind>:<host>:<id>` for hosted kinds. */
export function encodeGitMentionValue(kind: GitMentionRefKind, id: string, host?: GitHostProvider): string {
  return isGitHubRefKind(kind) ? `${kind}:${host ?? 'github'}:${id}` : `${kind}:${id}`
}

export function parseGitMentionValue(value: string): GitMentionValue | null {
  const sep = value.indexOf(':')
  if (sep < 0) return null
  const kind = value.slice(0, sep)
  const rest = value.slice(sep + 1)
  if (!isGitMentionRefKind(kind) || !rest) return null
  if (!isGitHubRefKind(kind)) return { kind, id: rest }
  const hostSep = rest.indexOf(':')
  if (hostSep < 0) return null
  const host = rest.slice(0, hostSep)
  const id = rest.slice(hostSep + 1)
  if (!isGitHostProvider(host) || !id) return null
  return { kind, id, host }
}

/**
 * Ref names (branch, worktree, tag) and commit subjects match fuzzily, like
 * session titles (same engine). A sha is the one exception: it matches by
 * prefix, which the host resolves through git itself.
 */
export function gitRefNameMatches(text: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  return fuzzyMatch(q, text).match
}

/** Kinds a person recognises by a title (`detail`) rather than by the ref name. */
function titledKind(kind: GitMentionRefKind): boolean {
  return kind === 'commit' || isGitHubRefKind(kind)
}

/**
 * True when the typed filter keeps this ref: the name fuzzily, or the title
 * for a commit / issue / PR. A worktree is named by its branch; its path is
 * shown, not searched.
 */
export function gitRefMatches(ref: Pick<GitMentionRef, 'kind' | 'label' | 'detail'>, query: string): boolean {
  return gitRefNameMatches(titledKind(ref.kind) ? ref.detail : ref.label, query)
}

/**
 * Highlight positions of the typed filter over a ref's label and detail.
 * A commit query may hit the sha (prefix) or the subject (fuzzy); an issue /
 * PR query the number (`#12` or `12`, prefix) or the title (fuzzy); the row
 * shows whichever matched. Every other kind highlights its fuzzy-matched name.
 */
export function gitRefMatchIndices(
  ref: Pick<GitMentionRef, 'kind' | 'label' | 'detail'>,
  query: string,
): { label: number[]; detail: number[] } {
  const needle = query.trim()
  if (!needle) return { label: [], detail: [] }
  const prefix = (text: string, q: string): number[] =>
    q && text.toLowerCase().startsWith(q.toLowerCase())
      ? Array.from({ length: Math.min(q.length, text.length) }, (_, i) => i)
      : []
  const fuzzy = (text: string): number[] => {
    const r = fuzzyMatch(needle, text)
    return r.match ? r.indices : []
  }
  if (ref.kind === 'commit') return { label: prefix(ref.label, needle), detail: fuzzy(ref.detail) }
  if (isGitHubRefKind(ref.kind)) {
    // The label is `#123`; a typed `12` still highlights the digits after `#`.
    const number = needle.replace(/^#/, '')
    const digits = /^\d+$/.test(number) ? prefix(ref.label.slice(1), number).map((i) => i + 1) : []
    return { label: digits, detail: fuzzy(ref.detail) }
  }
  // Details (a subject, a checkout path) are shown, never searched.
  return { label: fuzzy(ref.label), detail: [] }
}

export function shortSha(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH)
}

/**
 * What the chip shows for a ref: a commit by its subject (the sha is what the
 * tag carries, not what a person recognises), an issue / PR as `#12 title`,
 * every other kind by its name.
 */
export function gitMentionDisplayName(ref: Pick<GitMentionRef, 'kind' | 'id' | 'label' | 'detail'>): string {
  if (ref.kind === 'commit') return ref.detail.trim() || shortSha(ref.id)
  if (isGitHubRefKind(ref.kind)) return ref.detail.trim() ? `#${ref.id} ${ref.detail.trim()}` : `#${ref.id}`
  return ref.label
}
