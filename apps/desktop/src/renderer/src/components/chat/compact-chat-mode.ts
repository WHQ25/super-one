/**
 * Helpers for compact chat mode: split a completed turn into process vs
 * trailing conclusion. Process is collapsed under a "Detail" disclosure;
 * conclusion stays visible.
 *
 * Conclusion = trailing contiguous text-like segments from the end.
 * Intermediate narration between tools is process, not conclusion.
 */

export interface CompactTurnSplit<T> {
  process: T[]
  conclusion: T[]
}

/** Split items so trailing contiguous "conclusion" items are visible. */
export function splitTurnForCompactMode<T>(
  items: readonly T[],
  isConclusion: (item: T) => boolean,
): CompactTurnSplit<T> {
  let splitAt = items.length
  for (let i = items.length - 1; i >= 0; i--) {
    if (isConclusion(items[i])) splitAt = i
    else break
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
