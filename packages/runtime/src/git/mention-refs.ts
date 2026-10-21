/**
 * Rows for the `@git` / `@gh` mention popups — branches, commits, worktrees,
 * tags from the repository; issues and pull requests from GitHub via `gh`.
 *
 * Host-agnostic: the git (and gh) runners are injected so the desktop window
 * and the node's workspace Git service list refs with the same commands and
 * the same parsing. Everything is read-only.
 */

import {
  GIT_MENTION_REF_LIMIT,
  gitRefMatches,
  isGitHubRefKind,
  type GitHubItemState,
  type GitHubRefKind,
  type GitMentionCapabilities,
  type GitMentionRef,
  type GitMentionRefKind,
  type GitMentionRefsResult,
} from '@superone/shared/git-mention-query'
import { compareMentionMatchKeys, gitMentionRefMatchKey } from '@superone/shared/mention-match-tier'
import { isGhMissingError } from './gh-run'
import { isNotGitRepoError } from './sanitize-ref'
import { parseWorktreePorcelain } from './worktree-porcelain'

export type GitMentionRunner = (args: string[]) => Promise<string>

export interface GitMentionRunners {
  git: GitMentionRunner
  /** Absent on a host that cannot run `gh`; GitHub kinds then report `gh-unavailable`. */
  gh?: GitMentionRunner
}

/** Over-fetch so a name filter still fills a page from a long ref list. */
const REF_SCAN_LIMIT = 500
/** How far back a subject search looks; fuzzy matching cannot be pushed into `git log --grep`. */
const COMMIT_SCAN_LIMIT = 500

// `for-each-ref` spells NUL as `%00`; `log --format` spells it `%x00`.
const REF_FORMAT = ['%(refname:short)', '%(objectname)', '%(subject)', '%(committerdate:iso-strict)', '%(HEAD)'].join('%00')
const TAG_FORMAT = ['%(refname:short)', '%(objectname)', '%(subject)', '%(creatordate:iso-strict)'].join('%00')
const LOG_FORMAT = ['%H', '%s', '%an', '%aI'].join('%x00')

const HEX_PREFIX_RE = /^[0-9a-f]{4,40}$/i
const ISSUE_NUMBER_RE = /^#?(\d+)$/

const GH_ITEM_FIELDS = 'number,title,state,author,updatedAt'
const GH_PR_FIELDS = `${GH_ITEM_FIELDS},isDraft`

/** Kinds whose full list does not depend on the typed query. */
export type GitMentionScanKind = 'branch' | 'tag' | 'worktree'

export function gitMentionRefsFailure(err: unknown): GitMentionRefsResult {
  if (isNotGitRepoError(err)) return { ok: false, reason: 'not-repo' }
  return { ok: false, reason: 'error', error: (err as Error).message }
}

/**
 * Full branch, tag, or worktree list in git's recency order, with no name
 * filter. Callers cache this and then {@link filterRankGitMentionRefs}.
 */
export async function scanGitMentionRefs(
  kind: GitMentionScanKind,
  runners: GitMentionRunner | GitMentionRunners,
): Promise<GitMentionRef[]> {
  const { git } = typeof runners === 'function' ? { git: runners } : runners
  switch (kind) {
    case 'branch':
      return scanBranches(git)
    case 'tag':
      return scanTags(git)
    case 'worktree':
      return scanWorktrees(git)
  }
}

/**
 * Keep refs whose name matches `needle`, then stable-sort by match key.
 * The checked-out ref leads only a tie. An empty needle keeps recency and
 * still puts the checked-out ref first. The slice happens after the sort.
 */
export function filterRankGitMentionRefs(
  refs: readonly GitMentionRef[],
  needle: string,
  limit = GIT_MENTION_REF_LIMIT,
): GitMentionRef[] {
  const trimmed = needle.trim()
  const filtered = trimmed ? refs.filter((ref) => gitRefMatches(ref, trimmed)) : refs
  return rankGitMentionRefs(filtered, trimmed).slice(0, limit)
}

/** Stable key sort. Does not filter. An empty needle only lifts `current`. */
export function rankGitMentionRefs(refs: readonly GitMentionRef[], needle: string): GitMentionRef[] {
  const trimmed = needle.trim()
  return refs
    .map((ref, index) => ({ ref, index, key: trimmed ? gitMentionRefMatchKey(ref, trimmed) : null }))
    .sort((a, b) => {
      if (trimmed) {
        const cmp = compareMentionMatchKeys(a.key, b.key)
        if (cmp !== 0) return cmp
      }
      const current = Number(b.ref.current === true) - Number(a.ref.current === true)
      if (current) return current
      return a.index - b.index
    })
    .map((entry) => entry.ref)
}

export async function listGitMentionRefs(
  kind: GitMentionRefKind,
  query: string,
  runners: GitMentionRunner | GitMentionRunners,
  limit = GIT_MENTION_REF_LIMIT,
): Promise<GitMentionRefsResult> {
  const { git, gh } = typeof runners === 'function' ? { git: runners } : runners
  const needle = query.trim()
  if (isGitHubRefKind(kind)) {
    if (!gh) return { ok: false, reason: 'gh-unavailable' }
    try {
      const refs = rankGitMentionRefs(await listGitHubItems(kind, needle, gh), needle)
      return { ok: true, refs: refs.slice(0, limit) }
    } catch (err) {
      if (isGhMissingError(err)) return { ok: false, reason: 'gh-unavailable' }
      return { ok: false, reason: 'error', error: ghErrorMessage(err) }
    }
  }
  try {
    if (kind === 'commit') {
      const refs = rankGitMentionRefs(await listCommits(needle, git), needle)
      return { ok: true, refs: refs.slice(0, limit) }
    }
    const refs = await scanGitMentionRefs(kind, git)
    return { ok: true, refs: filterRankGitMentionRefs(refs, needle, limit) }
  } catch (err) {
    return gitMentionRefsFailure(err)
  }
}

/**
 * What the popup may offer for this checkout. `github` is one `gh repo view`:
 * it fails when `gh` is missing, signed out, or the repo has no GitHub remote,
 * which are exactly the cases `gh issue list` would fail in too.
 */
export async function probeGitMentionCapabilities(runners: GitMentionRunners): Promise<GitMentionCapabilities> {
  let repo: GitMentionCapabilities['repo'] = 'ready'
  try {
    await runners.git(['rev-parse', '--git-dir'])
  } catch {
    repo = 'not-repo'
  }
  if (repo !== 'ready' || !runners.gh) return { repo, github: false }
  try {
    await runners.gh(['repo', 'view', '--json', 'nameWithOwner'])
    return { repo, github: true }
  } catch {
    return { repo, github: false }
  }
}

function ghErrorMessage(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  const stderr = e.stderr?.trim()
  return stderr ? stderr.split('\n')[0]! : e.message ?? 'gh failed'
}

interface GhItem {
  number: number
  title: string
  state: string
  author?: { login?: string; name?: string }
  updatedAt?: string
  isDraft?: boolean
}

function ghItemState(item: GhItem): GitHubItemState {
  if (item.isDraft) return 'draft'
  const s = item.state.toLowerCase()
  return s === 'merged' ? 'merged' : s === 'closed' ? 'closed' : 'open'
}

function parseGhItems(kind: GitHubRefKind, raw: string): GitMentionRef[] {
  const items = JSON.parse(raw || '[]') as GhItem | GhItem[]
  return (Array.isArray(items) ? items : [items]).map((item) => ({
    kind,
    id: String(item.number),
    label: `#${item.number}`,
    detail: item.title ?? '',
    date: item.updatedAt,
    author: item.author?.login,
    state: ghItemState(item),
    host: 'github',
  }))
}

/**
 * Issues / pull requests through `gh`. No query → open ones, newest activity
 * first. A number → that item leads (exact), then whatever the search finds.
 * Text → GitHub's own search across all states, so a closed issue can still
 * be @-mentioned by title.
 */
async function listGitHubItems(kind: GitHubRefKind, needle: string, gh: GitMentionRunner): Promise<GitMentionRef[]> {
  const fields = kind === 'pr' ? GH_PR_FIELDS : GH_ITEM_FIELDS
  const list = (extra: string[]) => gh([kind, 'list', '--limit', String(GIT_MENTION_REF_LIMIT), '--json', fields, ...extra])
  if (!needle) return parseGhItems(kind, await list(['--state', 'open']))

  const searched = parseGhItems(kind, await list(['--state', 'all', '--search', needle]))
  const number = ISSUE_NUMBER_RE.exec(needle)?.[1]
  if (!number) return searched

  let exact: GitMentionRef[] = []
  try {
    exact = parseGhItems(kind, await gh([kind, 'view', number, '--json', fields]))
  } catch {
    // No such number — the search results are all there is.
  }
  const seen = new Set(exact.map((r) => r.id))
  return [...exact, ...searched.filter((r) => !seen.has(r.id))]
}

async function scanBranches(run: GitMentionRunner): Promise<GitMentionRef[]> {
  const raw = await run([
    'for-each-ref', 'refs/heads', '--sort=-committerdate', `--count=${REF_SCAN_LIMIT}`, `--format=${REF_FORMAT}`,
  ])
  const refs: GitMentionRef[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [name = '', , subject = '', date = '', head = ''] = line.split('\0')
    refs.push({ kind: 'branch', id: name, label: name, detail: subject, date, current: head === '*' })
  }
  return refs
}

async function scanTags(run: GitMentionRunner): Promise<GitMentionRef[]> {
  const raw = await run([
    'for-each-ref', 'refs/tags', '--sort=-creatordate', `--count=${REF_SCAN_LIMIT}`, `--format=${TAG_FORMAT}`,
  ])
  const refs: GitMentionRef[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [name = '', , subject = '', date = ''] = line.split('\0')
    refs.push({ kind: 'tag', id: name, label: name, detail: subject, date })
  }
  return refs
}

function parseLog(raw: string): GitMentionRef[] {
  const refs: GitMentionRef[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [sha = '', subject = '', author = '', date = ''] = line.split('\0')
    if (!sha) continue
    refs.push({ kind: 'commit', id: sha, label: sha.slice(0, 7), detail: subject, date, author })
  }
  return refs
}

async function listCommits(needle: string, run: GitMentionRunner): Promise<GitMentionRef[]> {
  if (!needle) return parseLog(await run(['log', `-n${GIT_MENTION_REF_LIMIT}`, `--format=${LOG_FORMAT}`]))

  // Subjects match fuzzily (recency order kept), so recent history is scanned
  // here rather than filtered by `--grep`. A hex query is most likely a sha
  // prefix: that commit leads, then subject matches — "abcd" can be in a
  // subject too.
  const recent = parseLog(await run(['log', `-n${COMMIT_SCAN_LIMIT}`, `--format=${LOG_FORMAT}`]))
  const byMessage = recent.filter((r) => gitRefMatches(r, needle))
  if (!HEX_PREFIX_RE.test(needle)) return byMessage

  let bySha: GitMentionRef[] = []
  try {
    bySha = parseLog(await run(['log', '-n1', `--format=${LOG_FORMAT}`, needle, '--']))
  } catch {
    // Not a resolvable object — message matches are all there is.
  }
  const seen = new Set(bySha.map((r) => r.id))
  return [...bySha, ...byMessage.filter((r) => !seen.has(r.id))]
}

async function scanWorktrees(run: GitMentionRunner): Promise<GitMentionRef[]> {
  const [raw, toplevel] = await Promise.all([
    run(['worktree', 'list', '--porcelain']),
    run(['rev-parse', '--show-toplevel']).catch(() => ''),
  ])
  const here = toplevel.trim().replace(/[\\/]+$/, '')
  const refs: GitMentionRef[] = []
  for (const wt of parseWorktreePorcelain(raw)) {
    if (wt.bare) continue
    const label = wt.branch ?? (wt.head ? `detached @ ${wt.head.slice(0, 7)}` : wt.path)
    refs.push({
      kind: 'worktree',
      id: wt.path,
      label,
      detail: wt.path,
      current: !!here && wt.path.replace(/[\\/]+$/, '') === here,
    })
  }
  return refs
}
