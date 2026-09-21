import type { ChatMessage, ContentBlock, RetractedBlockRef } from './agent-types'

/**
 * Every block that reports the outcome of a tool call, keyed by `toolUseId`.
 *
 * The desktop only ever sees `tool_result`. The remote projection sent to the
 * phone rewrites two of them into richer shapes — `bash_result` carries the
 * command echo plus pre-tokenised ANSI, `todo_result` carries the parsed todo
 * list — because the phone cannot recompute either from a stripped input.
 *
 * Anything that asks "did this tool finish, and what did it say" must accept all
 * three. Matching `tool_result` alone silently loses the result on mobile AND
 * leaves the row shimmering forever, since only a matched result seals a
 * `tool_use` out of `streaming`.
 */
export type ToolResultBlock = Extract<
  ContentBlock,
  { type: 'tool_result' | 'bash_result' | 'todo_result' }
>

export function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result' || block.type === 'bash_result' || block.type === 'todo_result'
}

/**
 * A tool call, under either the desktop's `tool_use` type or one of the remote
 * projection's per-tool types (`bash`, `edit`, `read`, …). `toolName` is what
 * every one of them carries and no result block does.
 */
export type ToolUseLikeBlock = Extract<ContentBlock, { toolName: string }>

export function isToolUseBlock(block: ContentBlock): block is ToolUseLikeBlock {
  return 'toolName' in block
}

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
// A result is only skippable while that call is still in the turn to act as the
// boundary. The remote projection drops the TodoWrite call and forwards only
// `todo_result`, so there the result IS the boundary — skipping it merged the
// agent's narration around six todo updates into one paragraph, printed before
// the lists it described.
function lastMergeTargetIndex(content: ContentBlock[], delta: ContentBlock): number {
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i]
    if (!sameParent(b, delta)) continue
    if (isToolResultBlock(b) && content.some((c) => isToolUseBlock(c) && c.toolUseId === b.toolUseId)) continue
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
export function applyContentDelta(
  content: ContentBlock[],
  delta: ContentBlock,
  now: () => number = Date.now,
): ContentBlock[] {
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
  // `isToolUseBlock`, not `type === 'tool_use'`: the remote projection types the
  // call by its tool (`bash`, `read`, …). Claude opens a tool block with an empty
  // input and fills it in a second delta, so matching the desktop shape alone
  // appended both — the phone drew the same call twice, once summary-less.
  if (isToolUseBlock(delta)) {
    const idx = content.findIndex((b) => isToolUseBlock(b) && b.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      const existing = content[idx]
      if (!isToolUseBlock(existing)) {
        return content.map((b, i) => (i === idx ? { ...delta, startedAt: now() } : b))
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
    return [...content, { ...delta, startedAt: now() }]
  }
  if (isToolResultBlock(delta)) {
    const updated = content.map((b) =>
      isToolUseBlock(b) && b.toolUseId === delta.toolUseId ? { ...b, status: 'complete' as const } : b,
    )
    return [...updated, delta]
  }
  return [...content, delta]
}

/**
 * Evict the blocks a retracted SDK frame produced (refusal fallback: the refused
 * partial is retracted and re-generated on the fallback model).
 *
 * Tool blocks resolve by id. A text/thinking ref is the frame's full payload:
 * a block equal to it is dropped outright; otherwise the LAST top-level block
 * that starts with it is the refused partial with the retry already merged onto
 * its tail (`applyContentDelta` folds consecutive same-parent deltas), so only
 * the refused prefix is stripped. Last-match is safe because the retraction
 * arrives before, or right as, the replacement starts streaming.
 * Dead-stream refs use `fromEnd` instead: only the latest block's suffix is
 * withdrawn, preserving any confirmed text already merged before it.
 *
 * Same `content` ref back when nothing matched — idempotent by contract.
 * Single source of truth for the renderer store AND the main-process runtime.
 */
export function retractContentBlocks(content: ContentBlock[], blocks: RetractedBlockRef[]): ContentBlock[] {
  const droppedToolUses = new Set<string>()
  const droppedToolResults = new Set<string>()
  for (const ref of blocks) {
    if (ref.type === 'tool_use') droppedToolUses.add(ref.toolUseId)
    else if (ref.type === 'tool_result') droppedToolResults.add(ref.toolUseId)
  }
  let next: ContentBlock[] = content.filter((b) => {
    if (isToolUseBlock(b)) return !droppedToolUses.has(b.toolUseId)
    if (isToolResultBlock(b)) return !droppedToolUses.has(b.toolUseId) && !droppedToolResults.has(b.toolUseId)
    return true
  })
  for (const ref of blocks) {
    if (ref.type !== 'text' && ref.type !== 'thinking') continue
    const payload = ref.type === 'text' ? ref.text : ref.thinking
    if (!payload) continue
    const own = (b: ContentBlock): string | undefined =>
      b.type === ref.type && !b.parentToolUseId ? (b.type === 'text' ? b.text : b.thinking) : undefined
    const lastIndexWhere = (test: (value: string) => boolean): number => {
      for (let i = next.length - 1; i >= 0; i--) {
        const value = own(next[i])
        if (value !== undefined && test(value)) return i
      }
      return -1
    }
    // A dead stream is withdrawn before its replacement starts. Its deltas
    // may have merged onto confirmed content, so remove only the newest suffix.
    // Do not search older blocks for equal text: those may be confirmed repeats.
    if (ref.fromEnd) {
      const idx = lastIndexWhere(() => true)
      if (idx === -1 || !own(next[idx])!.endsWith(payload)) continue
      const rest = own(next[idx])!.slice(0, -payload.length)
      next = rest
        ? next.map((b, i) => i === idx ? { ...b, ...(ref.type === 'text' ? { text: rest } : { thinking: rest }) } as ContentBlock : b)
        : next.filter((_, i) => i !== idx)
      continue
    }
    let idx = lastIndexWhere((value) => value === payload)
    if (idx === -1) idx = lastIndexWhere((value) => value.startsWith(payload))
    if (idx === -1) continue
    const block = next[idx]
    const rest = own(block)!.slice(payload.length)
    next = rest
      ? next.map((b, i) => (i === idx ? { ...b, ...(ref.type === 'text' ? { text: rest } : { thinking: rest }) } as ContentBlock : b))
      : next.filter((_, i) => i !== idx)
  }
  return next.length === content.length && next.every((b, i) => b === content[i]) ? content : next
}

/**
 * Stop in-flight tool chrome (wait_for shimmer, running verbs) on a turn that
 * already reached a terminal state. A `tool_use` only leaves `streaming` when a
 * matching `tool_result` lands (see `applyContentDelta`), and an aborted tool —
 * user Stop, or a steer that abandons the in-flight call — never sends one.
 * Without this the row shimmers forever and persists that way.
 *
 * Returns the same `content` ref when nothing was streaming, so React.memo and
 * the structural-sharing reducers keep working.
 *
 * Single source of truth for the renderer store AND the main-process session
 * runtime — both terminal paths must seal or the persisted transcript diverges
 * from what the user saw.
 */
export function sealStreamingTools(content: ContentBlock[]): ContentBlock[] {
  let changed = false
  const next = content.map((block) => {
    if (!isToolUseBlock(block) || block.status !== 'streaming') return block
    changed = true
    return { ...block, status: 'complete' as const }
  })
  return changed ? next : content
}

/**
 * Codex items that legitimately outlive the turn that started them. A video
 * render spans the submit call and a later status poll, so freezing its card
 * would replace real progress with a lie.
 */
const CODEX_DETACHED_ITEM_TYPES = new Set(['image_generation', 'video_generation'])

/**
 * Codex counterpart of {@link sealStreamingTools}.
 *
 * A Codex turn keeps its tool rows in `metadata.codex.items`, not in
 * `message.content`, so `sealStreamingTools` never sees them: the renderer maps
 * `in_progress` straight to a streaming row, and an interrupted turn leaves the
 * last tool shimmering ("Pressing…") forever — in the transcript AND in the DB.
 *
 * Same contract as the content seal: same ref back when nothing was in flight,
 * and BOTH terminal paths (renderer reducer + main-process runtime) must call it
 * or the persisted transcript diverges from what the user saw.
 */
export function sealCodexItems<T extends { id: string; type: string; status?: string }>(
  items: T[],
): T[] {
  let changed = false
  const next = items.map((item) => {
    if (CODEX_DETACHED_ITEM_TYPES.has(item.type)) return item
    // Collab items own a nested transcript; its rows shimmer independently.
    const children = (item as { childItems?: Record<string, T[]> }).childItems
    let nextChildren: Record<string, T[]> | undefined
    if (children) {
      for (const [threadId, childItems] of Object.entries(children)) {
        const sealedChildren = sealCodexItems(childItems)
        if (sealedChildren === childItems) continue
        nextChildren = { ...(nextChildren ?? children), [threadId]: sealedChildren }
      }
    }
    if (item.status !== 'in_progress' && !nextChildren) return item
    changed = true
    return {
      ...item,
      ...(item.status === 'in_progress' ? { status: 'completed' } : {}),
      ...(nextChildren ? { childItems: nextChildren } : {}),
    }
  })
  return changed ? next : items
}

/**
 * Seal a message's Codex transcript in place. Convenience wrapper so every
 * terminal path spells the `metadata.codex.items` walk the same way.
 */
export function sealCodexMetadata(
  metadata: ChatMessage['metadata'],
): ChatMessage['metadata'] {
  const items = metadata?.codex?.items
  if (!items?.length) return metadata
  const sealed = sealCodexItems(items)
  if (sealed === items) return metadata
  return { ...metadata, codex: { ...metadata!.codex!, items: sealed } }
}
