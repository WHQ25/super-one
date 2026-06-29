import type { ContentBlock } from './agent-types'

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

/**
 * Append a streamed ContentBlock delta to a message's flat content array.
 *
 * The content array is shared by the top-level agent AND every sub-agent of one
 * assistant message; ownership is carried per-block by `parentToolUseId`. Merging
 * consecutive text/thinking deltas therefore MUST stay within the same parent —
 * otherwise a sub-agent's text gets folded into the main agent's block (or another
 * sub-agent's), losing attribution and leaking into the main conversation.
 *
 * Single source of truth for both the renderer store and the main-process
 * persistence runtime — keep them on this one implementation.
 */
export function applyContentDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
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
