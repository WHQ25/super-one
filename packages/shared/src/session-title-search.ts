/**
 * Host-side session title search shared by the desktop database and the node.
 *
 * A title matches when the query is a case-insensitive subsequence of it.
 * {@link sessionTitleLikePatterns} is the SQL form of `mentionMatchTier`:
 * prefix, then a word separator, then a substring, then subsequence-only.
 * The caller breaks ties by recency. An empty query is the recent list and
 * does not use these patterns.
 */

import { MENTION_WORD_SEPARATORS } from './mention-match-tier'

function escapeLike(char: string): string {
  return char.replace(/[\\%_]/g, '\\$&')
}

/**
 * SQL `LIKE` patterns for `mentionMatchTier`, already lowercased.
 * Callers compare them to `LOWER(title)` with `ESCAPE '\'`.
 * `wordPrefix` is one pattern per {@link MENTION_WORD_SEPARATORS} entry.
 * The subsequence pattern is one code point at a time so a CJK query stays
 * one character per slot.
 */
export function sessionTitleLikePatterns(query: string): {
  prefix: string
  wordPrefix: string[]
  contains: string
  subsequence: string
} {
  const chars = Array.from(query.trim().toLowerCase()).map(escapeLike)
  const body = chars.join('')
  return {
    prefix: `${body}%`,
    wordPrefix: MENTION_WORD_SEPARATORS.map((separator) => `%${escapeLike(separator)}${body}%`),
    contains: `%${body}%`,
    subsequence: `%${chars.join('%')}%`,
  }
}

/** How many host folder paths one title search may name. */
export const MAX_SESSION_SEARCH_PATHS = 64

/** One path stays a folder path, not a pasted document. */
const MAX_SESSION_SEARCH_PATH_LENGTH = 4096

/**
 * `projectPaths` for a session title search.
 * `undefined` (also a missing or null value) means every project.
 * `null` means the value is not a short list of non-empty paths.
 */
export function parseSessionSearchProjectPaths(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > MAX_SESSION_SEARCH_PATHS) return null
  const paths: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_SESSION_SEARCH_PATH_LENGTH) return null
    paths.push(item)
  }
  return paths
}
