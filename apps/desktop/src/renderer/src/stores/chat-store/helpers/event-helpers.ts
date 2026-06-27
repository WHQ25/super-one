import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { compareMessageSeq } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'

export function extractSessionTitle(messages: ChatMessage[]): string | null {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  const text = firstUserMsg?.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ') ?? ''
  return stripMiniAppMarkup(text).slice(0, 100) || null
}

export function mergeMessagesByMaxSeq(snap: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
  const existingById = new Map(existing.map((m) => [m.id, m]))
  const result: ChatMessage[] = []
  const seen = new Set<string>()
  for (const sm of snap) {
    const em = existingById.get(sm.id)
    if (!em) {
      result.push(sm)
    } else {
      result.push(compareMessageSeq(em, sm) > 0 ? em : sm)
    }
    seen.add(sm.id)
  }
  for (const em of existing) {
    if (!seen.has(em.id)) result.push(em)
  }
  return result
}

function sameParent(a: ContentBlock, b: ContentBlock): boolean {
  const ap = 'parentToolUseId' in a ? a.parentToolUseId ?? null : null
  const bp = 'parentToolUseId' in b ? b.parentToolUseId ?? null : null
  return ap === bp
}

// The last block that can continue the same thinking/text run, scanning back
// past blocks that merely interleaved into the array rather than ending the run:
//   - blocks from another stream (different parentToolUseId), e.g. a subagent's
//     forwarded text streamed concurrently with the top-level agent's thinking;
//   - tool_result blocks, which the SDK delivers asynchronously and can land
//     between two deltas of the SAME thinking block (same content_block index).
// A same-stream tool_use is NOT skipped: it is a real reasoning boundary, so
// thinking before vs. after an agent's own tool call stays in separate blocks.
function lastMergeTargetIndex(content: ContentBlock[], delta: ContentBlock): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i]
    if (!sameParent(b, delta)) continue
    if (b.type === 'tool_result') continue
    return i
  }
  return -1
}

export function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
  if (delta.type === 'text') {
    const idx = lastMergeTargetIndex(content, delta)
    const target = idx === -1 ? undefined : content[idx]
    if (target?.type === 'text') {
      return content.map((b, i) => (i === idx ? { ...target, text: target.text + delta.text } : b))
    }
  }
  if (delta.type === 'thinking') {
    const idx = lastMergeTargetIndex(content, delta)
    const target = idx === -1 ? undefined : content[idx]
    if (target?.type === 'thinking') {
      // startedAt/endedAt are stamped upstream in the main process (claude-query);
      // carry them through — keep the run's original start, advance to the latest end.
      return content.map((b, i) => (i === idx ? { ...target, thinking: target.thinking + delta.thinking, endedAt: delta.endedAt ?? target.endedAt } : b))
    }
  }
  if (delta.type === 'tool_use') {
    const idx = content.findIndex((b) => b.type === 'tool_use' && b.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      const existing = content[idx]
      const preserved = existing.type === 'tool_use'
        ? { startedAt: existing.startedAt, elapsedSeconds: existing.elapsedSeconds, ...(!delta.status && existing.status ? { status: existing.status } : {}) }
        : {}
      return content.map((b, i) => (i === idx ? { ...preserved, ...delta } : b))
    }
    return [...content, { ...delta, startedAt: Date.now() }]
  }
  if (delta.type === 'tool_result') {
    const updated = content.map((b) =>
      b.type === 'tool_use' && b.toolUseId === delta.toolUseId ? { ...b, status: 'complete' as const } : b,
    )
    return [...updated, delta]
  }
  return [...content, delta]
}
