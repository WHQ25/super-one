import type { ContentBlock } from './agent-types'

/** Fields that carry UI-facing summary text for tool rows. */
const SUMMARY_INPUT_KEYS = [
  'query', 'pattern', 'command', 'description', 'file_path', 'path',
  'url', 'prompt', 'skill', 'tool_name', 'subject', 'task_id',
] as const

function parseInputObject(input: unknown): Record<string, unknown> {
  if (input == null || input === '') return {}
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  if (typeof input !== 'string' || !input.trim()) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/**
 * Merge successive tool_use input payloads. Later keys win, but empty/missing
 * summary fields fall back to the earlier value so sparse ACP updates do not
 * erase query/pattern already shown in the UI.
 *
 * Returns a JSON string when either side was a string (production path);
 * returns a plain object when both sides were objects (legacy/test path).
 */
export function mergeToolUseInputJson(existing: unknown, incoming: unknown): string | Record<string, unknown> {
  const prev = parseInputObject(existing)
  const next = parseInputObject(incoming)
  const asString = typeof existing === 'string' || typeof incoming === 'string'
  if (Object.keys(next).length === 0) {
    if (existing != null && existing !== '') return existing as string | Record<string, unknown>
    return asString ? (typeof incoming === 'string' ? incoming : '{}') : (incoming as Record<string, unknown> ?? {})
  }
  if (Object.keys(prev).length === 0) {
    return asString
      ? (typeof incoming === 'string' ? incoming : JSON.stringify(next))
      : next
  }
  const merged: Record<string, unknown> = { ...prev, ...next }
  for (const key of SUMMARY_INPUT_KEYS) {
    const n = merged[key]
    const empty = n == null || n === ''
    if (empty && prev[key] != null && prev[key] !== '') {
      merged[key] = prev[key]
    }
  }
  if (!asString) return merged
  try {
    return JSON.stringify(merged)
  } catch {
    return typeof incoming === 'string' ? incoming : '{}'
  }
}

function pickRicherToolSummary(
  existing: string | undefined,
  incoming: string | undefined,
  mergedInput: unknown,
): string | undefined {
  const input = parseInputObject(mergedInput)
  for (const key of ['query', 'pattern', 'command', 'description'] as const) {
    const v = input[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const a = existing?.trim() || ''
  const b = incoming?.trim() || ''
  // Prefer the more informative non-placeholder title.
  const placeholders = new Set(['Web search:', 'web_search', 'grep', 'Grep', 'Search'])
  if (b && !placeholders.has(b)) return b
  if (a && !placeholders.has(a)) return a
  return b || a || undefined
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
      if (existing.type !== 'tool_use') {
        return content.map((b, i) => (i === idx ? { ...delta, startedAt: Date.now() } : b))
      }
      // Sparse ACP updates (status/content only, or backend web_search without query)
      // must not wipe a richer prior input / toolSummary.
      const mergedInput = mergeToolUseInputJson(existing.input, delta.input)
      const mergedSummary = pickRicherToolSummary(
        existing.toolSummary,
        delta.toolSummary,
        mergedInput,
      )
      return content.map((b, i) => (i === idx
        ? {
            ...existing,
            ...delta,
            startedAt: existing.startedAt,
            elapsedSeconds: delta.elapsedSeconds ?? existing.elapsedSeconds,
            status: delta.status ?? existing.status,
            // ContentBlock.input is typed as string; object form is test/legacy only.
            input: mergedInput as string,
            toolSummary: mergedSummary,
            toolFilePath: delta.toolFilePath || existing.toolFilePath,
          }
        : b))
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
