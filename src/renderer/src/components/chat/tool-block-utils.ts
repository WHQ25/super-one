import { splitContentLines } from '@/lib/diff-utils'

function countContentLines(text: string): number {
  return splitContentLines(text).length
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
    if (!oldStr && !newStr) return null
    return { added: countContentLines(newStr), removed: countContentLines(oldStr) }
  }
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

export function tryPrettifyJson(text: string): string | null {
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed, null, 2)
    }
  } catch { /* not JSON */ }
  return null
}

export function parseQAPairs(text: string): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = []
  const regex = /"([^"]+)"="([^"]*)"/g
  let match
  while ((match = regex.exec(text)) !== null) {
    pairs.push({ question: match[1], answer: match[2] })
  }
  return pairs
}
