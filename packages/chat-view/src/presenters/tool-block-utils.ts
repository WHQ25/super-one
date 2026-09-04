import { diffLines } from 'diff'

function splitContentLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

function countContentLines(text: string): number {
  return splitContentLines(text).length
}

function ensureTrailingNewline(s: string): string {
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

let streamingDeltaCache: {
  oldStr: string
  committedNew: string
  result: { added: number; removed: number } | null
} | null = null

export function computeStreamingEditDelta(oldStr: string, newStr: string): { added: number; removed: number } | null {
  if (!oldStr && !newStr) return null
  const lastNewline = newStr.lastIndexOf('\n')
  if (lastNewline === -1) return null
  const committedNew = newStr.slice(0, lastNewline + 1)
  if (!committedNew) return null
  if (streamingDeltaCache && streamingDeltaCache.oldStr === oldStr && streamingDeltaCache.committedNew === committedNew) {
    return streamingDeltaCache.result
  }
  const changes = diffLines(ensureTrailingNewline(oldStr), committedNew)
  let oldIdx = 0
  let unchangedCount = 0
  let addedCount = 0
  let lastUnchangedOldEnd = -1
  for (const c of changes) {
    const cnt = c.count ?? 0
    if (c.added) {
      addedCount += cnt
    } else if (c.removed) {
      oldIdx += cnt
    } else {
      lastUnchangedOldEnd = oldIdx + cnt - 1
      unchangedCount += cnt
      oldIdx += cnt
    }
  }
  const removed = unchangedCount === 0 ? 0 : (lastUnchangedOldEnd + 1) - unchangedCount
  const result = addedCount > 0 || removed > 0 ? { added: addedCount, removed } : null
  streamingDeltaCache = { oldStr, committedNew, result }
  return result
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

/** Keys the MCP reply envelope is allowed to carry — anything else means it is real tool JSON. */
const MCP_ENVELOPE_KEYS = new Set(['content', 'isError', 'structuredContent', '_meta'])

/**
 * Claude reports an MCP tool's outcome as the serialized MCP reply envelope
 * (`{"content":[{"text":{"text":"…"}}],"isError":false}`), while native tools report the plain
 * text they returned. Every block that parses a result — counts, origins, pretty-printed output —
 * would otherwise inspect the wrapper and silently find nothing, so unwrap once at the ToolBlock
 * boundary. The key allowlist keeps a tool that genuinely returns `{content:[…]}` from being
 * mistaken for an envelope, and anything unrecognized passes through untouched.
 */
export function unwrapMcpResultText(result: string): string {
  if (!result.trimStart().startsWith('{')) return result
  let data: unknown
  try { data = JSON.parse(result) } catch { return result }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result
  const envelope = data as Record<string, unknown>
  if (!Array.isArray(envelope.content)) return result
  if (Object.keys(envelope).some((key) => !MCP_ENVELOPE_KEYS.has(key))) return result

  const parts: string[] = []
  for (const item of envelope.content) {
    if (!item || typeof item !== 'object') continue
    const text = (item as { text?: unknown }).text
    if (typeof text === 'string') parts.push(text)
    else if (text && typeof text === 'object' && typeof (text as { text?: unknown }).text === 'string') {
      parts.push((text as { text: string }).text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : result
}
