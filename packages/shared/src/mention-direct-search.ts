/**
 * Plain `@foo` (no portal keyword) also searches session titles and git refs.
 * One gate for both composers: long enough to be a name, and not already
 * inside `@session` / `@git` / `@gh`. A `/` stays in the query: branch names
 * and paths both contain one, and a missing directory falls back to this search.
 */

import { isGitMentionQuery, type GitMentionPortal } from './git-mention-query'
import { compareMentionMatchKeys, type MentionMatchKey } from './mention-match-tier'
import { isSessionMentionQuery } from './session-mention-query'

/** Rows per group (sessions, and each plain git kind) while the query is plain. */
export const PLAIN_MENTION_GROUP_LIMIT = 3

/**
 * Groups that leave their fixed slots and fill the `file` slot while
 * `shouldDirectSearch` is true. This is membership, not the tie order —
 * equal scores use {@link DIRECT_SEARCH_KEY_TIE_ORDER}.
 */
export const DIRECT_SEARCH_RANKED_GROUPS = ['file', 'session', 'git-branch', 'git-worktree', 'git-tag'] as const

export type DirectSearchRankedGroup = (typeof DIRECT_SEARCH_RANKED_GROUPS)[number]

/** Equal match keys: branches, worktrees, tags, sessions, then files. */
const DIRECT_SEARCH_KEY_TIE_ORDER = ['git-branch', 'git-worktree', 'git-tag', 'session', 'file'] as const

/**
 * Group-key order for `groupItems` while `shouldDirectSearch` is true.
 *
 * Ranked groups leave their fixed slots and fill the `file` slot, best key
 * first. A missing key sorts after every real key and then by
 * {@link DIRECT_SEARCH_KEY_TIE_ORDER}. Every other key stays where it was,
 * including the MCP keys that already sit just before files.
 */
export function orderDirectSearchGroups<K extends string>(
  baseOrder: readonly K[],
  keys: Partial<Record<DirectSearchRankedGroup, MentionMatchKey | null | undefined>>,
): K[] {
  const rankedSet = new Set<string>(DIRECT_SEARCH_RANKED_GROUPS)
  const present = new Set<string>(baseOrder)
  const ranked = DIRECT_SEARCH_RANKED_GROUPS.filter((key) => present.has(key)).sort((a, b) => {
    const cmp = compareMentionMatchKeys(keys[a], keys[b])
    if (cmp !== 0) return cmp
    return DIRECT_SEARCH_KEY_TIE_ORDER.indexOf(a) - DIRECT_SEARCH_KEY_TIE_ORDER.indexOf(b)
  })
  const fileIndex = baseOrder.indexOf('file' as K)
  const rest: K[] = []
  let insertAt = 0
  for (let i = 0; i < baseOrder.length; i++) {
    const key = baseOrder[i]!
    if (rankedSet.has(key)) continue
    if (fileIndex < 0 || i < fileIndex) insertAt += 1
    rest.push(key)
  }
  rest.splice(insertAt, 0, ...(ranked as K[]))
  return rest
}

export function shouldDirectSearch(
  query: string,
  portals?: readonly GitMentionPortal[],
): boolean {
  const q = query.trim()
  if (q.length < 2) return false
  if (isSessionMentionQuery(q)) return false
  if (isGitMentionQuery(q, portals)) return false
  return true
}
