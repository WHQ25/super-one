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
 *
 * Collapse threshold and Detail badge use *visible* process segments only
 * (hidden tool calls / paired tool_result shells do not count).
 */

/** Min visible process segments before compact mode collapses them under Detail. */
export const MIN_PROCESS_SEGMENTS_TO_COLLAPSE = 3

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

type ClaudeVisibilitySeg = {
  kind: string
  blocks?: ReadonlyArray<{ type: string; toolName?: string; toolUseId?: string }>
  block?: { type: string; toolName?: string; toolUseId?: string }
}

export interface ClaudeSegmentVisibilityOpts {
  /** Resolve tool_result text for a tool_use id (used by media hide-on-success). */
  toolResultAt: (toolUseId: string) => string | undefined
  /** Same predicate ToolBlock uses — inject to avoid coupling this module to tool-display. */
  isHiddenTool: (toolName: string, result?: string) => boolean
}

/**
 * Whether a Claude/ACP process segment produces any chat UI.
 * Mirrors ToolBlock / renderBlock: hidden tools and paired tool_result shells
 * render nothing and must not affect collapse threshold or Detail count.
 */
export function isVisibleClaudeProcessSegment(
  seg: ClaudeVisibilitySeg,
  opts: ClaudeSegmentVisibilityOpts,
): boolean {
  const { toolResultAt, isHiddenTool } = opts
  if (seg.kind === 'thinking' || seg.kind === 'subagent' || seg.kind === 'workflow') {
    return true
  }
  if (seg.kind === 'tools' || seg.kind === 'app-tools') {
    return (seg.blocks ?? []).some(
      (b) =>
        b.type === 'tool_use'
        && !isHiddenTool(b.toolName ?? '', toolResultAt(b.toolUseId ?? '')),
    )
  }
  if (seg.kind === 'block' && seg.block) {
    const b = seg.block
    // tool_result is always attached to its tool_use ToolBlock (or empty).
    if (b.type === 'tool_result') return false
    if (b.type === 'tool_use') {
      return !isHiddenTool(b.toolName ?? '', toolResultAt(b.toolUseId ?? ''))
    }
    return true
  }
  return true
}

/** Count process segments that actually paint in compact-mode UI. */
export function countVisibleClaudeProcessSegments(
  segs: ReadonlyArray<ClaudeVisibilitySeg>,
  opts: ClaudeSegmentVisibilityOpts,
): number {
  let n = 0
  for (const seg of segs) {
    if (isVisibleClaudeProcessSegment(seg, opts)) n += 1
  }
  return n
}

