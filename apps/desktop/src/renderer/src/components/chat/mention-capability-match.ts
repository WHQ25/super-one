/**
 * Ranking for built-in @-mentions (collab / computer / browser / session).
 *
 * The token after `@` (keyword / id) always outranks display-name text so that
 * typing `@se` prefers `@session` over "Computer Use" (which substring-matches "se").
 */

export type BuiltinMentionMatchRank =
  | 0 // keyword prefix
  | 1 // keyword substring
  | 2 // display label only

export interface BuiltinMentionMatch {
  /** Lower is better. */
  rank: BuiltinMentionMatchRank
  /** Highlight indices into a display label (empty when only the keyword matched). */
  labelIndices: number[]
  /** Highlight indices into the @keyword id. */
  keywordIndices: number[]
}

function substringIndices(text: string, query: string): number[] | null {
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
 * Score a built-in mention against the typed query after `@`.
 * Returns null when neither the keyword nor any label matches.
 */
export function matchBuiltinMention(
  keyword: string,
  labels: readonly string[],
  query: string,
): BuiltinMentionMatch | null {
  const q = query.trim()
  if (!q) {
    return { rank: 0, labelIndices: [], keywordIndices: [] }
  }

  const keywordLow = keyword.toLowerCase()
  const qLow = q.toLowerCase()

  if (keywordLow.startsWith(qLow)) {
    const keywordIndices: number[] = []
    for (let i = 0; i < qLow.length; i++) keywordIndices.push(i)
    // Prefer label highlight when the label also matches; otherwise only @id highlights.
    let labelIndices: number[] = []
    for (const label of labels) {
      const idx = substringIndices(label, q)
      if (idx) {
        labelIndices = idx
        break
      }
    }
    return { rank: 0, labelIndices, keywordIndices }
  }

  const keywordSub = substringIndices(keyword, q)
  if (keywordSub) {
    let labelIndices: number[] = []
    for (const label of labels) {
      const idx = substringIndices(label, q)
      if (idx) {
        labelIndices = idx
        break
      }
    }
    return { rank: 1, labelIndices, keywordIndices: keywordSub }
  }

  for (const label of labels) {
    const labelIndices = substringIndices(label, q)
    if (labelIndices) {
      return { rank: 2, labelIndices, keywordIndices: [] }
    }
  }

  return null
}

/** Sort helper: better rank first, then shorter keyword, then A→Z. */
export function compareBuiltinMentionMatches(
  a: { rank: BuiltinMentionMatchRank; keyword: string },
  b: { rank: BuiltinMentionMatchRank; keyword: string },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.keyword.length !== b.keyword.length) return a.keyword.length - b.keyword.length
  return a.keyword.localeCompare(b.keyword)
}
