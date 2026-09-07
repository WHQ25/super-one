export interface FuzzyMatchResult {
  match: boolean
  score: number
  indices: number[]
}

function forwardMatchFrom(queryLower: string, textLower: string, start: number): number[] {
  const indices: number[] = []
  let qi = 0
  for (let pi = start; pi < textLower.length && qi < queryLower.length; pi++) {
    if (textLower[pi] === queryLower[qi]) {
      indices.push(pi)
      qi++
    }
  }
  return indices
}

function scoreIndices(indices: number[], query: string, text: string): number {
  let score = 0
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!
    if (i > 0 && idx === indices[i - 1]! + 1) score += 5
    if (text[idx] === query[i]) score += 1
  }
  if (indices.length > 0 && indices[0] === 0) score += 10
  score -= text.length * 0.1
  return score
}

/**
 * Subsequence match with a preference for contiguous runs and prefixes.
 *
 * Matching is case-insensitive, but **scoring is not**: a character that matches
 * the query's exact case earns an extra point. Callers therefore get different
 * scores depending on whether they lowercase the query first, and they do not
 * agree — the desktop slash popup lowercases before calling, the mobile one
 * passes the raw query. Both are load-bearing today; do not "normalise" one to
 * the other without deciding which ranking is correct.
 *
 * This is the scorer for short identifiers — command names, capability ids,
 * session titles. File-path search uses a different one
 * (`@superone/runtime/fs` → `fuzzy.ts`), which is fzf-backed and adds a
 * basename bonus; the two are not interchangeable.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatchResult {
  if (!query) return { match: true, score: 0, indices: [] }

  const queryLower = query.toLowerCase()
  const textLower = text.toLowerCase()

  const fwd = forwardMatchFrom(queryLower, textLower, 0)
  if (fwd.length < queryLower.length) return { match: false, score: 0, indices: [] }

  let bestIndices = fwd
  let bestScore = scoreIndices(fwd, query, text)

  const startPositions = new Set<number>()
  for (let pi = 1; pi < textLower.length; pi++) {
    if (textLower[pi] === queryLower[0]) startPositions.add(pi)
  }
  for (const start of startPositions) {
    const candidate = forwardMatchFrom(queryLower, textLower, start)
    if (candidate.length < queryLower.length) continue
    const s = scoreIndices(candidate, query, text)
    if (s > bestScore) {
      bestScore = s
      bestIndices = candidate
    }
  }

  return { match: true, score: bestScore, indices: bestIndices }
}
