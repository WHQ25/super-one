import { diffLines } from 'diff'
import { splitContentLines } from '@/lib/diff-utils'

function countContentLines(text: string): number {
  return splitContentLines(text).length
}

function countEditDelta(oldStr: string, newStr: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const change of diffLines(oldStr, newStr)) {
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
    const { added, removed } = countEditDelta(oldStr, newStr)
    return added > 0 || removed > 0 ? { added, removed } : null
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

export function extractToolError(text: string): string {
  const match = text.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/)
  return match ? match[1].trim() : text
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
