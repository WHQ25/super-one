/** Structural mirror of the shared `DiffTokenLine` (a private alias in agent-types). */
export type DiffTokenLine = [string, string | null][]

export interface RemoteDiffTokens { added?: DiffTokenLine[]; removed?: DiffTokenLine[] }

export type NativeDiffLine = { kind: 'added' | 'removed' | 'context'; text: string; line: number; tokens?: [string, string | null][] }

/** Remote tokens index source lines, including unchanged context, not rendered rows. */
export function parseNativeDiff(diff: string, tokens?: RemoteDiffTokens): NativeDiffLine[] {
  const result: NativeDiffLine[] = []
  let oldLine = 1, newLine = 1, oldIndex = 0, newIndex = 0
  const unified = /^@@ /m.test(diff)
  let inHunk = !unified
  let oldRemaining = Infinity, newRemaining = Infinity
  for (const row of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row)
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[3]); oldRemaining = Number(hunk[2] ?? 1); newRemaining = Number(hunk[4] ?? 1); inHunk = true; continue }
    if (unified && /^(diff |index )/.test(row)) { inHunk = false; continue }
    if (!inHunk || row.startsWith('\\') || (unified && !/^[+ -]/.test(row))) continue
    const kind = row.startsWith('+') ? 'added' : row.startsWith('-') ? 'removed' : 'context'
    const text = /^[+ -]/.test(row) ? row.slice(1) : row
    const source = kind === 'removed' ? tokens?.removed?.[oldIndex] : tokens?.added?.[newIndex]
    // Never apply stale tokens to different text (e.g. truncated or multi-file patches).
    result.push({ kind, text, line: kind === 'removed' ? oldLine : newLine, tokens: source?.map(([part]: [string, string | null]) => part).join('') === text ? source : undefined })
    if (kind !== 'added') { oldLine++; oldIndex++; oldRemaining-- }
    if (kind !== 'removed') { newLine++; newIndex++; newRemaining-- }
    if (unified && oldRemaining <= 0 && newRemaining <= 0) inHunk = false
  }
  return result
}
