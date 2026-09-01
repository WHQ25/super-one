import { isWidgetShowTool } from './media-generation'

/**
 * Helpers for compact chat mode: partition a completed turn into collapsible
 * process runs and pinned runs. Process is collapsed under a single "Detail"
 * disclosure; pinned content stays visible at its original position, so
 * expanding Detail restores the turn's real order instead of re-ordering it.
 *
 * Pinned = the agent's own prose (markdown) and tools whose call *is* addressed
 * to the user (widget_show, AskUserQuestion), wherever they appear — mid-turn
 * narration is content, not process. Everything after the last pinned item is
 * pinned too, so an interrupted turn that ends mid-tool still surfaces its
 * incomplete tail.
 *
 * Collapse threshold and Detail badge use *visible* process segments only
 * (hidden tool calls / paired tool_result shells do not count).
 */

/**
 * Tools whose call is aimed at the user rather than at the task: a widget is
 * the answer's surface, and a question is a turn addressed to the reader.
 * Burying either under "Detail" hides the one thing the turn wants seen.
 */
export function isPinnedToolName(toolName: string): boolean {
  return isWidgetShowTool(toolName)
    || toolName === 'AskUserQuestion'
    || toolName.endsWith('__AskUserQuestion')
}

/** Min visible process segments before compact mode collapses them under Detail. */
export const MIN_PROCESS_SEGMENTS_TO_COLLAPSE = 3

/** One contiguous stretch of a turn: either collapsible process or pinned content. */
export interface TurnRun<T> {
  /** True when this run hides behind the Detail disclosure. */
  collapsible: boolean
  /** Index of the run's first item in the original turn — renderers read neighbours by position. */
  start: number
  items: T[]
}

/**
 * Split a turn into ordered runs so pinned items stay visible in place.
 *
 * - Pinned items (and everything after the last pinned one) render always.
 * - Every other item joins the adjacent collapsible run.
 * - A turn with no pinned item at all is one collapsible run.
 */
export function partitionTurnForCompactMode<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
): TurnRun<T>[] {
  if (items.length === 0) return []
  let lastPinned = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (isPinned(items[i])) {
      lastPinned = i
      break
    }
  }
  if (lastPinned < 0) return [{ collapsible: true, start: 0, items: items.slice() as T[] }]

  const runs: TurnRun<T>[] = []
  for (let i = 0; i < items.length; i++) {
    const collapsible = i < lastPinned && !isPinned(items[i])
    const last = runs[runs.length - 1]
    if (last && last.collapsible === collapsible) last.items.push(items[i])
    else runs.push({ collapsible, start: i, items: [items[i]] })
  }
  return runs
}

/** Flatten the collapsible runs — what the threshold and the Detail badge measure. */
export function collapsibleItems<T>(runs: ReadonlyArray<TurnRun<T>>): T[] {
  return runs.flatMap((run) => (run.collapsible ? run.items : []))
}

/** Claude / ACP content segments: bare text blocks and user-facing tool calls are pinned. */
export function isClaudePinnedSegment(seg: {
  kind: string
  block?: { type: string; toolName?: string }
}): boolean {
  if (seg.kind !== 'block' || !seg.block) return false
  if (seg.block.type === 'text') return true
  return seg.block.type === 'tool_use' && isPinnedToolName(seg.block.toolName ?? '')
}

/**
 * Codex topology segments: agent_message / plan / user-facing tool items are pinned.
 * `itemAt` resolves a segment index into the full codex item list.
 */
export function isCodexPinnedSegment(
  seg: { kind: string; index?: number },
  itemAt: (index: number) => { type: string; server?: string; tool?: string } | undefined,
): boolean {
  if (seg.kind !== 'item' || seg.index == null) return false
  const item = itemAt(seg.index)
  if (!item) return false
  if (item.type === 'agent_message' || item.type === 'plan') return true
  return item.type === 'mcp_tool_call' && isPinnedToolName(`mcp__${item.server}__${item.tool}`)
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

