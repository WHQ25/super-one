/**
 * Helpers for compact chat mode: split a completed turn into process vs
 * trailing conclusion. Process is collapsed under a "Detail" disclosure;
 * conclusion stays visible.
 *
 * Conclusion starts at the last contiguous block of text-like segments and
 * includes everything after it. That way a normal turn ending in markdown
 * only shows the trailing answer, while an interrupted turn that ends mid-
 * tool still surfaces the last answer plus the incomplete tail.
 *
 * Intermediate narration between earlier tools stays in process.
 */

export interface CompactTurnSplit<T> {
  process: T[]
  conclusion: T[]
}

/**
 * Split items so the final answer (and any tail after it) stays visible.
 *
 * - Finds the last conclusion item, then expands left through contiguous
 *   conclusion items — that block is the start of the visible conclusion.
 * - Everything after that block is also visible (e.g. tools after the last
 *   markdown when the turn was interrupted).
 * - If there is no conclusion item, the whole turn is process.
 */
export function splitTurnForCompactMode<T>(
  items: readonly T[],
  isConclusion: (item: T) => boolean,
): CompactTurnSplit<T> {
  let lastConclusion = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (isConclusion(items[i])) {
      lastConclusion = i
      break
    }
  }
  if (lastConclusion < 0) {
    return {
      process: items.slice() as T[],
      conclusion: [],
    }
  }
  let splitAt = lastConclusion
  while (splitAt > 0 && isConclusion(items[splitAt - 1])) {
    splitAt--
  }
  return {
    process: items.slice(0, splitAt) as T[],
    conclusion: items.slice(splitAt) as T[],
  }
}

/** Claude / ACP content segments: only bare text blocks are conclusions. */
export function isClaudeConclusionSegment(seg: {
  kind: string
  block?: { type: string }
}): boolean {
  return seg.kind === 'block' && seg.block?.type === 'text'
}

/**
 * Codex topology segments: trailing agent_message / plan items are conclusions.
 * `items` is the full codex item list; segment indices point into it.
 */
export function isCodexConclusionSegment(
  seg: { kind: string; index?: number },
  itemTypeAt: (index: number) => string | undefined,
): boolean {
  if (seg.kind !== 'item' || seg.index == null) return false
  const type = itemTypeAt(seg.index)
  return type === 'agent_message' || type === 'plan'
}

type ClaudeProcessSeg = {
  kind: string
  blocks?: ReadonlyArray<{ type: string }>
  block?: { type: string }
}

/** Count tool-like units in Claude process segments for the Detail indicator. */
export function countClaudeProcessTools(segs: ReadonlyArray<ClaudeProcessSeg>): number {
  let n = 0
  for (const seg of segs) {
    if (seg.kind === 'tools' || seg.kind === 'app-tools') {
      n += (seg.blocks ?? []).filter((b) => b.type === 'tool_use').length
    } else if (seg.kind === 'subagent' || seg.kind === 'workflow') {
      n += 1
    } else if (seg.kind === 'block' && seg.block?.type === 'tool_use') {
      n += 1
    }
  }
  return n
}

const CODEX_NON_TOOL_TYPES = new Set(['reasoning', 'agent_message', 'plan', 'todo_list', 'image_generation', 'video_generation'])

type CodexProcessSeg = {
  kind: string
  index?: number
  indices?: ReadonlyArray<number>
}

/** Count tool-like units in Codex process segments for the Detail indicator. */
export function countCodexProcessTools(
  segs: ReadonlyArray<CodexProcessSeg>,
  itemTypeAt: (index: number) => string | undefined,
): number {
  let n = 0
  for (const seg of segs) {
    if (seg.kind === 'group' || seg.kind === 'app-tools') {
      n += seg.indices?.length ?? 0
    } else if (seg.kind === 'subagent') {
      n += 1
    } else if (seg.kind === 'item' && seg.index != null) {
      const type = itemTypeAt(seg.index)
      if (type && !CODEX_NON_TOOL_TYPES.has(type)) n += 1
    }
  }
  return n
}
