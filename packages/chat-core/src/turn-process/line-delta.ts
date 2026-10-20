import { diffLines } from 'diff'

function splitContentLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

function countContentLines(text: string): number {
  return splitContentLines(text).length
}

export function ensureTrailingNewline(s: string): string {
  if (!s) return s
  return s.endsWith('\n') ? s : s + '\n'
}

function countEditDelta(oldStr: string, newStr: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of diffLines(ensureTrailingNewline(oldStr), ensureTrailingNewline(newStr))) {
    if (change.added) added += change.count ?? 0
    else if (change.removed) removed += change.count ?? 0
  }
  return { added, removed }
}

export function countUnifiedDiffDelta(diff: string): { added: number; removed: number } | null {
  if (!diff) return null
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  let inHunk = false
  let added = 0
  let removed = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }

  return added > 0 || removed > 0 ? { added, removed } : null
}

export function countPrefixedDiffDelta(diff: string): { added: number; removed: number } | null {
  if (!diff) return null
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return added > 0 || removed > 0 ? { added, removed } : null
}

/** Count +/− from a unified/prefixed diff, then Cursor result line totals. */
function countParamsDiffDelta(params: Record<string, unknown>): { added: number; removed: number } | null {
  const diff = String(params.diff ?? params.diffString ?? '')
  if (diff) {
    const counted = countUnifiedDiffDelta(diff) ?? countPrefixedDiffDelta(diff)
    if (counted) return counted
  }
  const added = Number(params.linesAdded)
  const removed = Number(params.linesRemoved)
  const hasAdded = Number.isFinite(added) && added > 0
  const hasRemoved = Number.isFinite(removed) && removed > 0
  if (!hasAdded && !hasRemoved) return null
  return { added: hasAdded ? added : 0, removed: hasRemoved ? removed : 0 }
}

export function computeLineDelta(toolName: string, params: Record<string, unknown>): { added: number; removed: number } | null {
  if (toolName === 'Write') {
    const content = String(params.content ?? '')
    if (!content) return null
    const added = countContentLines(content)
    return { added, removed: 0 }
  }
  if (toolName === 'Edit') {
    const oldStr = String(params.old_string ?? '')
    const newStr = String(params.new_string ?? '')
    if (oldStr || newStr) {
      const { added, removed } = countEditDelta(oldStr, newStr)
      return added > 0 || removed > 0 ? { added, removed } : null
    }
    // Cursor Edit has no old/new strings — the expanded body already renders
    // result.diffString, so the header uses the same payload after the call ends.
    return countParamsDiffDelta(params)
  }
  // A Bash edit row for a removed file carries the deleted lines as a diff.
  if (toolName === 'Delete') return countParamsDiffDelta(params)
  if (toolName === 'FileChange') {
    const kind = String(params.kind ?? '')
    const diff = String(params.diff ?? '')
    if (!diff) return null
    if (kind === 'add') return { added: countContentLines(diff), removed: 0 }
    if (kind === 'delete') return { added: 0, removed: countContentLines(diff) }
    return countUnifiedDiffDelta(diff) ?? countPrefixedDiffDelta(diff)
  }
  return null
}
