import type { ChatMessage, ContentBlock, ProcessFoldSummary } from '@superone/shared/agent-types'
import { isToolResultBlock } from '@superone/shared/content-delta'
import { isLegacyCodexMessage } from '@superone/shared/codex-content'
import { MAX_FOLD_FILES } from '@superone/shared/environment/transcript-window'
import { blockText, boundaryCursor, contentKeys, contentKeySpan } from '@superone/shared/transcript-boundary'
import { transcriptView } from '@superone/shared/transcript-segments'
import type { FoldRange } from '@superone/shared/transcript-window/folds'
import {
  collapsibleItems,
  compactTurnRuns,
  countVisibleClaudeProcessSegments,
  isVisibleClaudeProcessSegment,
  MIN_PROCESS_SEGMENTS_TO_COLLAPSE,
} from './compact-mode'
import { groupContentPresenter, type RenderSegment } from './group-content'
import { isHiddenToolBlock, isTurnGallerySourceTool } from './media-tools'
import { isOffTranscriptBlock, isPortablePinnedSegment, portableToolBlock, portableToolBlocks, PORTABLE_GROUP_PORTS, turnDisplayContent } from './portable'
import { summarizeClaudeProcessFiles } from './process-stats'

/** Fewest blocks worth a fold; a shorter run costs less inline than a round trip on expand. */
export const MIN_FOLD_BLOCKS = 4

export interface ProcessFoldPlan {
  /** Content ranges to fold, in order. */
  ranges: FoldRange[]
  /** What the foldable blocks of `start`..`end` (content indexes, inclusive) add to the Detail header. */
  summarize(start: number, end: number): Omit<ProcessFoldSummary, 'fragments'>
  /**
   * Content index where a streaming turn's open suffix starts. Fragments
   * before it are the closed intervals (before and between compactions) and
   * stay in the live window; the suffix keeps the streaming render.
   */
  liveFrom?: number
}

const NO_FOLDS: ProcessFoldPlan = { ranges: [], summarize: () => ({ segments: 0, toolCalls: 0, files: [], added: 0, removed: 0, contentKey: '' }) }

/** Other rows that cut this turn. The planner reads the same neighbours the compact view does. */
export interface ProcessFoldContext {
  cuts?: readonly ChatMessage[]
}

type FoldMessage = Pick<ChatMessage, 'role' | 'status'> & {
  content: readonly ContentBlock[]
  id?: string
  metadata?: ChatMessage['metadata']
  providerId?: ChatMessage['providerId']
}

/**
 * The process a settled assistant turn collapses under its compact Detail
 * header, read with the phone view's own grouping and pinning: each
 * contiguous stretch of it becomes a fold. A stretch stops at anything the
 * turn shows while collapsed or reads from the whole turn — prose, pinned
 * calls and their results, gallery sources, off-transcript blocks — so
 * folding never changes what the collapsed turn renders. A transcript cut
 * is planned as its own row, with that row's neighbours, so a fold cannot
 * cross it.
 */
export function planProcessFolds(message: FoldMessage, context?: ProcessFoldContext): ProcessFoldPlan {
  if (message.role !== 'assistant') return NO_FOLDS
  const cuts = (context?.cuts ?? []).filter((cut) => cut.metadata?.transcriptBoundary?.messageId === message.id)
  // A streaming turn stays open, except the intervals a compaction has already
  // closed: those collapse the same way a settled slice does, and the suffix
  // after the latest cut keeps streaming.
  if (message.status === 'streaming') {
    if (!cuts.length || !message.id || isLegacyCodexMessage(message)) return NO_FOLDS
    return planStreamingCuts(message, cuts)
  }
  if (cuts.length > 0 && message.id && !isLegacyCodexMessage(message)) return planSliced(message, cuts)
  return planContent(message, message.content)
}

/** Plans for one closed prefix. The tail text grows every token; the prefix does not. */
const streamingPlans = new Map<string, ProcessFoldPlan>()

/**
 * Fold only what a compaction has closed. `liveFrom` is the first block of
 * the open suffix, so a live window can keep the closed prefix and tail the rest.
 */
function planStreamingCuts(message: FoldMessage, cuts: readonly ChatMessage[]): ProcessFoldPlan {
  const liveFrom = openSuffixStart(message, cuts)
  if (liveFrom <= 0) return NO_FOLDS
  const closedKeys = contentKeys(message.content.slice(0, liveFrom)).join('\n')
  const cacheKey = `${message.id}:${liveFrom}:${closedKeys}:${cuts.map((cut) => `${cut.id}:${cut.metadata?.transcriptBoundary?.order ?? ''}`).join('|')}`
  const cached = streamingPlans.get(cacheKey)
  if (cached) return cached
  const planned = planSliced({ ...message, status: 'complete' }, cuts)
  const ranges: FoldRange[] = []
  for (const range of planned.ranges) {
    if (range.start >= liveFrom) continue
    const end = Math.min(range.end, liveFrom - 1)
    if (end - range.start + 1 < MIN_FOLD_BLOCKS) continue
    ranges.push(end === range.end ? range : { ...range, end, summary: planned.summarize(range.start, end) })
  }
  const plan: ProcessFoldPlan = { ranges, summarize: planned.summarize, liveFrom }
  streamingPlans.set(cacheKey, plan)
  if (streamingPlans.size > 32) streamingPlans.delete(streamingPlans.keys().next().value!)
  return plan
}

/** First block of the open suffix: the latest cut's block, or the end when the cut is past every block. */
function openSuffixStart(message: FoldMessage, cuts: readonly ChatMessage[]): number {
  const latest = cuts.reduce((best, cut) =>
    (cut.metadata!.transcriptBoundary!.order > best.metadata!.transcriptBoundary!.order ? cut : best))
  const boundary = latest.metadata?.transcriptBoundary
  if (!boundary) return message.content.length
  const source = message as ChatMessage
  const cursor = boundary.cursor ? boundary : boundaryCursor(boundary, source)
  const keys = contentKeys(message.content)
  if (cursor.at) {
    const index = keys.indexOf(cursor.at)
    return index < 0 ? message.content.length : index
  }
  if (cursor.cursor) return message.content.length
  const map = boundary.content ?? {}
  for (let index = 0; index < keys.length; index++) {
    const saved = map[keys[index]]
    const text = blockText(message.content[index])
    if (saved === undefined) return index
    if (text !== undefined && saved < text.length) return index
  }
  return message.content.length
}

function planSliced(message: FoldMessage, cuts: readonly ChatMessage[]): ProcessFoldPlan {
  const source: ChatMessage = {
    id: message.id!,
    role: 'assistant',
    status: message.status === 'error' ? 'error' : 'complete',
    createdAt: '',
    providerId: message.providerId ?? 'claude',
    content: message.content as ContentBlock[],
    ...(message.metadata ? { metadata: message.metadata } : {}),
  }
  const grouped = groupTurn(turnDisplayContent(source))
  const opts = visibility(grouped)
  if (countVisibleClaudeProcessSegments(collapsibleItems(compactTurnRuns(grouped.segments, isPortablePinnedSegment)), opts) < MIN_PROCESS_SEGMENTS_TO_COLLAPSE) return NO_FOLDS
  const indexOf = new Map(message.content.map((block, index) => [block, index]))
  const foldable = new Array<ContentBlock | undefined>(message.content.length)
  const anchored = new Map<number, RenderSegment>()
  const calls = new Set<string>()
  const sliceEnds = new Set<number>()
  const spans: number[][] = []
  for (const row of transcriptView([source, ...cuts]).rows) {
    if (row.source.id !== source.id) continue
    const indexes: number[] = []
    for (const block of row.message.content) {
      const index = indexOf.get(block)
      if (index !== undefined) indexes.push(index)
    }
    spans.push(indexes)
    const slice = groupTurn(turnDisplayContent(row.message))
    const following = row.following ? groupTurn(turnDisplayContent(row.following)) : undefined
    const runs = compactTurnRuns(slice.segments, isPortablePinnedSegment, { source: grouped.segments, following: following?.segments })
    markFoldable(runs, (block) => indexOf.get(block), foldable, anchored, calls)
  }
  // A tool result captured before the cut can be rewritten later in the message.
  // Those copies stay on the earlier slice, so its highest index sits past the
  // next slice. The fold stops at the last block that is still before that slice.
  spans.forEach((indexes, span) => {
    let nextStart = Number.POSITIVE_INFINITY
    for (let later = span + 1; later < spans.length; later++) {
      for (const index of spans[later]) if (index < nextStart) nextStart = index
    }
    let end = -1
    for (const index of indexes) if (index < nextStart && index > end) end = index
    if (end >= 0) sliceEnds.add(end)
  })
  for (const block of message.content) {
    const index = indexOf.get(block)
    if (index !== undefined && isToolResultBlock(block) && calls.has(block.toolUseId)) foldable[index] = block
  }
  return finish(message.content, foldable, anchored, visibility(grouped), sliceEnds)
}

function planContent(message: FoldMessage, content: readonly ContentBlock[]): ProcessFoldPlan {
  const indexes: number[] = []
  const blocks: ContentBlock[] = []
  content.forEach((block, index) => {
    if (isOffTranscriptBlock(block, message)) return
    indexes.push(index)
    blocks.push(portableToolBlock(block))
  })
  const grouped = groupContentPresenter(blocks, PORTABLE_GROUP_PORTS)
  const opts = visibility(grouped)
  const runs = compactTurnRuns(grouped.segments, isPortablePinnedSegment)
  if (countVisibleClaudeProcessSegments(collapsibleItems(runs), opts) < MIN_PROCESS_SEGMENTS_TO_COLLAPSE) return NO_FOLDS
  const position = new Map(blocks.map((block, index) => [block, index]))
  const foldable = new Array<ContentBlock | undefined>(content.length)
  const anchored = new Map<number, RenderSegment>()
  const calls = new Set<string>()
  markFoldable(runs, (block) => indexes[position.get(block)!], foldable, anchored, calls)
  for (const block of blocks) {
    if (isToolResultBlock(block) && calls.has(block.toolUseId)) foldable[indexes[position.get(block)!]] = block
  }
  return finish(content, foldable, anchored, opts)
}

function groupTurn(content: ContentBlock[]) {
  return groupContentPresenter(portableToolBlocks(content), PORTABLE_GROUP_PORTS)
}

function visibility(grouped: ReturnType<typeof groupContentPresenter>) {
  return {
    toolResultAt: (id: string) => grouped.toolResultMap.get(id),
    isHiddenTool: isHiddenToolBlock,
    isErrorTool: (id: string) => grouped.errorToolIds.has(id),
    bashEditDiffAt: (id: string) => grouped.bashEditDiffMap.get(id),
  }
}

/** Collapsible runs become foldable blocks. A gallery source stays in the window so the turn-end gallery can still read it. */
function markFoldable(
  runs: ReturnType<typeof compactTurnRuns<RenderSegment>>,
  contentIndex: (block: ContentBlock) => number | undefined,
  foldable: Array<ContentBlock | undefined>,
  anchored: Map<number, RenderSegment>,
  calls: Set<string>,
): void {
  for (const run of runs) {
    if (!run.collapsible) continue
    for (const segment of run.items) {
      const members = segmentBlocks(segment)
      const first = members[0] ? contentIndex(members[0]) : undefined
      if (first !== undefined) anchored.set(first, segment)
      for (const block of members) {
        const index = contentIndex(block)
        if (index === undefined) continue
        if ('toolName' in block && isTurnGallerySourceTool(block.toolName)) continue
        foldable[index] = block
        if ('toolName' in block) calls.add(block.toolUseId)
      }
    }
  }
}

function finish(
  content: readonly ContentBlock[],
  foldable: Array<ContentBlock | undefined>,
  anchored: Map<number, RenderSegment>,
  opts: ReturnType<typeof visibility>,
  sliceEnds?: ReadonlySet<number>,
): ProcessFoldPlan {
  const keys = contentKeys(content)
  const summarize = (start: number, end: number): Omit<ProcessFoldSummary, 'fragments'> => {
    let segments = 0
    const tools: RenderSegment[] = []
    for (let i = start; i <= end; i++) {
      const segment = anchored.get(i)
      if (segment && foldable[i] && isVisibleClaudeProcessSegment(segment, opts)) segments++
      const block = foldable[i]
      if (block?.type === 'tool_use') tools.push({ kind: 'block', block, index: i })
    }
    const { stats, files, moreFiles } = summarizeClaudeProcessFiles(tools, opts)
    const listed = [...files].slice(0, MAX_FOLD_FILES)
    const more = files.size - listed.length + moreFiles
    return {
      segments, toolCalls: stats.toolCalls, files: listed, ...(more ? { moreFiles: more } : {}), added: stats.added, removed: stats.removed,
      ...contentKeySpan(content, keys, start, end),
    }
  }
  const ranges: FoldRange[] = []
  for (let start = 0; start < foldable.length;) {
    if (!foldable[start]) { start++; continue }
    let end = start
    while (end + 1 < foldable.length && foldable[end + 1] && !sliceEnds?.has(end)) end++
    if (end - start + 1 >= MIN_FOLD_BLOCKS) ranges.push({ start, end, summary: summarize(start, end) })
    start = end + 1
  }
  return ranges.length ? { ranges, summarize } : NO_FOLDS
}

function segmentBlocks(segment: RenderSegment): ContentBlock[] {
  switch (segment.kind) {
    case 'block': return [segment.block]
    case 'subagent': return [segment.taskBlock, ...segment.childBlocks, ...(segment.resultBlock ? [segment.resultBlock] : [])]
    case 'workflow': return [segment.toolBlock, ...(segment.resultBlock ? [segment.resultBlock] : [])]
    default: return segment.blocks
  }
}
