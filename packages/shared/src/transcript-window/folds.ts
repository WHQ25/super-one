import type { ProcessFoldSummary } from '../agent-types'
import type { TranscriptWindowBudget } from '../environment/transcript-window'
import { contentDigest } from './content-digest'
import { entry, type FragmentEntry, type MessageFragments } from './fragment-message'

/** Prefix of a fold's key; the rest is the key of its first inner fragment. */
export const FOLD_KEY_PREFIX = 'fold:'
/** Visible characters credited to a page's fragment, as a window credits a block. */
const PAGE_BLOCK_CHARS = 120

/** Content blocks a host folds, inclusive, and what they add to their turn's Detail header. */
export interface FoldRange {
  start: number
  end: number
  summary: Omit<ProcessFoldSummary, 'fragments'>
}

export interface FoldInner {
  entries: FragmentEntry[]
  /** Content index of each entry's block. */
  blocks: number[]
}

/** A message's fragments with each folded range cut down to one `fold` fragment. */
export interface FoldedFragments extends MessageFragments {
  folds: ReadonlyMap<string, FoldInner>
}

/** A fold's revision: its inner keys and digests, so a client can check fragments it already holds. */
export function foldRevision(fragments: ReadonlyArray<{ key: string; digest: string }>): string {
  return contentDigest(fragments.map((fragment) => `${fragment.key} ${fragment.digest}`).join('\n'))
}

/** `ranges` must be sorted and disjoint. A fold costs no visible characters: it paints nothing while collapsed. */
export function foldMessageFragments(message: MessageFragments, ranges: readonly FoldRange[]): FoldedFragments {
  const fragments: FragmentEntry[] = []
  const blocks: number[] = []
  const folds = new Map<string, FoldInner>()
  let r = 0
  for (let i = 0; i < message.fragments.length;) {
    const block = message.blocks[i]
    while (r < ranges.length && ranges[r].end < block) r++
    const range = ranges[r]
    if (!range || block < range.start) {
      fragments.push(message.fragments[i])
      blocks.push(block)
      i++
      continue
    }
    const inner: FoldInner = { entries: [], blocks: [] }
    for (; i < message.fragments.length && message.blocks[i] <= range.end; i++) {
      inner.entries.push(message.fragments[i])
      inner.blocks.push(message.blocks[i])
    }
    const key = FOLD_KEY_PREFIX + inner.entries[0].key
    folds.set(key, inner)
    fragments.push(entry(key, { kind: 'fold', revision: foldRevision(inner.entries), summary: { ...range.summary, fragments: inner.entries.length } }, 0))
    blocks.push(range.start)
    r++
  }
  return { ...message, fragments, blocks, folds }
}

/**
 * The next page behind a fold: from after `after` (the start when absent)
 * until the budget is met, then the results of the calls the page holds. A
 * sliced text or plan block stays whole, so the remainder's summary starts at
 * the next block and does not count this one again: a page that would end
 * inside one ends before it, or takes all of it when the page starts there.
 * Null when `after` is not inside.
 */
export function selectFoldPage(inner: FoldInner, after: string | undefined, budget: TranscriptWindowBudget): { start: number; end: number } | null {
  const start = after === undefined ? 0 : inner.entries.findIndex((fragment) => fragment.key === after) + 1
  if (start <= 0 && after !== undefined) return null
  let end = start
  let bytes = 0
  let chars = 0
  const calls = new Set<string>()
  for (; end < inner.entries.length; end++) {
    const fragment = inner.entries[end]
    if (end > start && (end - start >= budget.maxFragments || bytes + fragment.bytes > budget.maxBytes || chars >= budget.targetChars)) break
    bytes += fragment.bytes
    chars += PAGE_BLOCK_CHARS
    const call = callId(fragment)
    if (call) calls.add(call)
  }
  if (end > start && end < inner.entries.length && inner.blocks[end] === inner.blocks[end - 1]) {
    const block = inner.blocks[end - 1]
    let first = end - 1
    while (first > start && inner.blocks[first - 1] === block) first--
    if (first > start) end = first
    else while (end < inner.entries.length && inner.blocks[end] === block) end++
  }
  for (; end < inner.entries.length; end++) {
    const result = resultOf(inner.entries[end])
    if (!result || !calls.has(result)) break
  }
  return { start, end }
}

function callId(fragment: FragmentEntry): string | undefined {
  const block = fragment.body.kind === 'block' ? fragment.body.block : undefined
  return block && 'toolName' in block ? block.toolUseId : undefined
}

function resultOf(fragment: FragmentEntry): string | undefined {
  const block = fragment.body.kind === 'block' ? fragment.body.block : undefined
  return block && !('toolName' in block) && 'toolUseId' in block ? block.toolUseId : undefined
}
