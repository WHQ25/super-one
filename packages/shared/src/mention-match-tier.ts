/**
 * One match score for mention search: session titles, file names, and git refs.
 *
 * The tier is 0 when the text starts with the query, 1 when the query starts
 * right after a separator, 2 when the text contains the query, and 3 when the
 * query is only a subsequence. `null` does not match. Comparison is
 * case-insensitive and walks code points, so a CJK query is one character
 * per slot. An empty query is tier 0 (everything matches).
 *
 * {@link mentionMatchKey} breaks a tier tie: a match that ends at the end of
 * the text or just before a separator beats one that continues inside the
 * same segment, then a shorter segment wins, then a shorter text. Callers
 * add their own tie-breakers (checked-out ref, recency) after that.
 */

/** Characters that open a new word in a title, path, or ref name. */
export const MENTION_WORD_SEPARATORS = [' ', '/', '-', '_', '.'] as const

const SEPARATORS = new Set<string>(MENTION_WORD_SEPARATORS)

export type MentionMatchTier = 0 | 1 | 2 | 3

/**
 * Lexicographic score. Smaller is better.
 * `wholeSegment` is 0 when the contiguous run (tiers 0–2) ends at the end of
 * the text or on a separator, otherwise 1. A subsequence is never a whole
 * segment. `segmentLength` is the separator-delimited segment that holds the
 * start of the match.
 */
export interface MentionMatchKey {
  tier: MentionMatchTier
  wholeSegment: 0 | 1
  segmentLength: number
  textLength: number
}

/**
 * A sha or issue-number prefix. Segment and text lengths of 0 sit strictly
 * ahead of any key built from a title, path, or subject.
 */
const IDENTIFIER_KEY: MentionMatchKey = { tier: 0, wholeSegment: 0, segmentLength: 0, textLength: 0 }

export function mentionMatchKey(text: string, query: string): MentionMatchKey | null {
  const needle = Array.from(query.trim().toLowerCase())
  const hay = Array.from((text ?? '').toLowerCase())
  if (needle.length === 0) {
    return { tier: 0, wholeSegment: 0, segmentLength: segmentLengthAt(hay, 0), textLength: hay.length }
  }
  if (startsAt(hay, needle, 0)) return keyAt(hay, 0, needle.length, 0)
  for (let i = 1; i <= hay.length - needle.length; i++) {
    if (!SEPARATORS.has(hay[i - 1]!) || !startsAt(hay, needle, i)) continue
    return keyAt(hay, i, needle.length, 1)
  }
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (!startsAt(hay, needle, i)) continue
    return keyAt(hay, i, needle.length, 2)
  }
  let at = 0
  let start = -1
  for (let i = 0; i < hay.length; i++) {
    if (hay[i] !== needle[at]) continue
    if (at === 0) start = i
    at += 1
    if (at === needle.length) {
      return { tier: 3, wholeSegment: 1, segmentLength: segmentLengthAt(hay, start), textLength: hay.length }
    }
  }
  return null
}

/** Smaller key first. A missing key sorts after every real key. */
export function compareMentionMatchKeys(
  a: MentionMatchKey | null | undefined,
  b: MentionMatchKey | null | undefined,
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (a.tier !== b.tier) return a.tier - b.tier
  if (a.wholeSegment !== b.wholeSegment) return a.wholeSegment - b.wholeSegment
  if (a.segmentLength !== b.segmentLength) return a.segmentLength - b.segmentLength
  return a.textLength - b.textLength
}

/**
 * Stable re-sort by {@link mentionMatchKey}. Equal keys keep the incoming
 * order, which for sessions is the host's recency order.
 */
export function sortByMentionMatch<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, key: mentionMatchKey(text(item), query) }))
    .sort((a, b) => compareMentionMatchKeys(a.key, b.key) || a.index - b.index)
    .map((entry) => entry.item)
}

export function mentionMatchTier(text: string, query: string): MentionMatchTier | null {
  return mentionMatchKey(text, query)?.tier ?? null
}

/**
 * File rows score the basename. A miss falls through to the full path so a
 * directory segment can still match (`src/feat/index.ts` vs `feat`). A
 * trailing slash is not part of the basename (`docs/features/` → `features`).
 */
export function fileMentionMatchKey(path: string, query: string): MentionMatchKey | null {
  const base = path.split(/[/\\]/).filter(Boolean).pop() ?? path
  const byName = mentionMatchKey(base, query)
  if (byName != null || base === path) return byName
  return mentionMatchKey(path, query)
}

export function fileMentionMatchTier(path: string, query: string): MentionMatchTier | null {
  return fileMentionMatchKey(path, query)?.tier ?? null
}

/**
 * Git ref score. Branch, tag, and worktree names score `label`. A commit
 * whose sha starts with the query, or an issue / pull request whose number
 * starts with the query (with or without `#`), outranks every title.
 * Otherwise the subject or title is scored.
 */
export function gitMentionRefMatchKey(
  ref: { kind: string; id: string; label: string; detail?: string },
  query: string,
): MentionMatchKey | null {
  const needle = query.trim()
  if (!needle) return mentionMatchKey(ref.label, '')
  if (ref.kind === 'commit') {
    if (ref.id.toLowerCase().startsWith(needle.toLowerCase())) return IDENTIFIER_KEY
    return mentionMatchKey(ref.detail ?? '', needle)
  }
  if (ref.kind === 'issue' || ref.kind === 'pr') {
    const number = needle.replace(/^#/, '')
    if (/^\d+$/.test(number) && ref.id.startsWith(number)) return IDENTIFIER_KEY
    return mentionMatchKey(ref.detail ?? '', needle)
  }
  return mentionMatchKey(ref.label, needle)
}

export function gitMentionRefMatchTier(
  ref: { kind: string; id: string; label: string; detail?: string },
  query: string,
): MentionMatchTier | null {
  return gitMentionRefMatchKey(ref, query)?.tier ?? null
}

function keyAt(hay: readonly string[], start: number, needleLength: number, tier: 0 | 1 | 2): MentionMatchKey {
  const end = start + needleLength
  const boundary = end === hay.length || SEPARATORS.has(hay[end]!)
  return {
    tier,
    wholeSegment: boundary ? 0 : 1,
    segmentLength: segmentLengthAt(hay, start),
    textLength: hay.length,
  }
}

function segmentLengthAt(hay: readonly string[], index: number): number {
  if (hay.length === 0) return 0
  let start = Math.min(index, hay.length - 1)
  while (start > 0 && !SEPARATORS.has(hay[start - 1]!)) start -= 1
  let end = start
  while (end < hay.length && !SEPARATORS.has(hay[end]!)) end += 1
  return end - start
}

function startsAt(hay: readonly string[], needle: readonly string[], index: number): boolean {
  if (index + needle.length > hay.length) return false
  for (let i = 0; i < needle.length; i++) {
    if (hay[index + i] !== needle[i]) return false
  }
  return true
}
