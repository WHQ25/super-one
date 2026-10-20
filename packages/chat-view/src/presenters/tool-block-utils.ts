import { diffLines } from 'diff'
import { ensureTrailingNewline } from '@superone/chat-core/turn-process/line-delta'

export { computeLineDelta, countPrefixedDiffDelta, countUnifiedDiffDelta } from '@superone/chat-core/turn-process/line-delta'

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
