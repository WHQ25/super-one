import type { ChatMessage, ContentBlock, CodexThreadItem } from './agent-types'
import { codexAsyncQuestionItems, isCodexAsyncAnswer } from './codex-async-question'
import { isToolResultBlock, isToolUseBlock } from './content-delta'

/**
 * A durable cursor into a provider message, whose identity never changes.
 * A window ships the slim form (`cursor`): `content` and `items` are empty,
 * and the cut is the first block that was not fully before it. An empty map
 * without `cursor` still means the cut is at the start.
 */
export interface TranscriptBoundary {
  messageId: string
  order: number
  content: Record<string, number>
  items: Record<string, number>
  cursor?: boolean
  /** First content key not fully before the cut. Absent when the cut is past every current block. */
  at?: string
  /** Characters of `at` before the cut. Only text and thinking use it; `0` means `at` is entirely after. */
  offset?: number
  atItem?: string
  itemOffset?: number
}

// Reserve an ordinal before an async steering RPC. A compaction can arrive
// before that accepted answer is appended, so persisted rows alone are not enough.
const capturedOrders = new Map<string, number>()

/** Where a window slice's block sits in the whole message. `start` is the original text offset of the first held character. */
export interface ContentKeyStamp { key: string; start: number; prefix: number }

const contentKeyStamps = new WeakMap<ContentBlock, ContentKeyStamp>()

/** Remember the whole-message content key of a block a window materialized from a slice. */
export function stampContentKey(block: ContentBlock, key: string, start = 0, prefix = 0): void {
  contentKeyStamps.set(block, { key, start, prefix })
}

export function contentKeyStamp(block: ContentBlock): ContentKeyStamp | undefined {
  return contentKeyStamps.get(block)
}

export function contentKeys(content: readonly ContentBlock[]): string[] {
  const counts = new Map<string, number>()
  return content.map(block => {
    // A window's fold stands where its first block stood and uses up the ordinals of the blocks behind it.
    if (block.type === 'notice' && block.fold) {
      for (const [kind, count] of Object.entries(block.fold.keyCounts ?? {})) counts.set(kind, (counts.get(kind) ?? 0) + count)
      return block.fold.contentKey
    }
    const stamped = contentKeyStamps.get(block)
    if (stamped) {
      const ordinal = /^(.*):(\d+)$/.exec(stamped.key)
      if (ordinal) counts.set(ordinal[1], Math.max(counts.get(ordinal[1]) ?? 0, Number(ordinal[2]) + 1))
      return stamped.key
    }
    if (isToolUseBlock(block)) return `tool:${block.toolUseId}`
    if (isToolResultBlock(block)) return `result:${block.toolUseId}`
    const kind = contentKeyKind(block)
    const count = counts.get(kind) ?? 0
    counts.set(kind, count + 1)
    return `${kind}:${count}`
  })
}

function contentKeyKind(block: ContentBlock): string {
  const parent = 'parentToolUseId' in block ? block.parentToolUseId ?? '' : ''
  return `${block.type}:${parent}`
}

/** The `contentKey` and `keyCounts` of a fold over `content[start..end]`, given the turn's `contentKeys`. */
export function contentKeySpan(content: readonly ContentBlock[], keys: readonly string[], start: number, end: number): { contentKey: string; keyCounts?: Record<string, number> } {
  const keyCounts: Record<string, number> = {}
  for (let i = start; i <= end; i++) {
    const block = content[i]
    if (isToolUseBlock(block) || isToolResultBlock(block)) continue
    const kind = contentKeyKind(block)
    keyCounts[kind] = (keyCounts[kind] ?? 0) + 1
  }
  return { contentKey: keys[start], ...(Object.keys(keyCounts).length ? { keyCounts } : {}) }
}

export function blockText(block: ContentBlock): string | undefined {
  return block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : undefined
}

export function itemText(item: CodexThreadItem): string | undefined {
  return 'text' in item ? item.text : undefined
}

export function transcriptLengths(message: ChatMessage): Pick<TranscriptBoundary, 'content' | 'items'> {
  const keys = contentKeys(message.content)
  return {
    content: Object.fromEntries(message.content.map((block, index) => [keys[index], blockText(block)?.length ?? -1])),
    items: Object.fromEntries((message.metadata?.codex?.items ?? []).map(item => [item.id, itemText(item)?.length ?? -1])),
  }
}

/**
 * The boundary as a transcript window can carry it. A prefix cut collapses to
 * one edge. A key already recorded before that edge may repeat later — a plan
 * result is rewritten in place — and those copies are not content captured
 * after the cut. A key whose first block sits after the hole and is still in
 * the map is not a prefix: one edge would move it, so the map is returned
 * unchanged. An already slim cursor is returned as-is: its empty map would
 * otherwise look like a cut at the first block.
 */
export function boundaryCursor(boundary: TranscriptBoundary, source: ChatMessage): TranscriptBoundary {
  if (boundary.cursor) return boundary
  const items = source.metadata?.codex?.items ?? []
  const contentEdge = prefixEdge(boundary.content ?? {}, contentKeys(source.content), source.content.map(blockText))
  const itemEdge = prefixEdge(boundary.items ?? {}, items.map(item => item.id), items.map(itemText))
  if (contentEdge === null || itemEdge === null) return boundary
  return {
    messageId: boundary.messageId,
    order: boundary.order,
    content: {},
    items: {},
    cursor: true,
    ...(contentEdge === 'end' ? {} : { at: contentEdge.key, offset: contentEdge.offset }),
    ...(itemEdge === 'end' ? {} : { atItem: itemEdge.key, itemOffset: itemEdge.offset }),
  }
}

/** The content map a window cursor names, read against the message the client is drawing. */
export function expandBoundaryCursor(boundary: TranscriptBoundary, source: ChatMessage): TranscriptBoundary {
  if (!boundary.cursor) return boundary
  const items = source.metadata?.codex?.items ?? []
  const keys = contentKeys(source.content)
  const content = boundary.at !== undefined && !keys.includes(boundary.at)
    ? coverBeforeCut(source.content, boundary.at) ?? {}
    : edgeMap(keys, source.content.map(blockText), boundary.at, boundary.offset ?? 0, source.content.map(contentKeyStamp))
  return {
    ...boundary,
    content,
    items: edgeMap(items.map(item => item.id), items.map(itemText), boundary.atItem, boundary.itemOffset ?? 0),
    cursor: false,
  }
}

/**
 * Whether a cut falls inside the message a window is drawing. A tail that
 * starts after the cut must not draw the marker: the omitted prefix still
 * owns that position, and a missing key would otherwise pin every marker to
 * the start of the slice.
 */
export function boundaryInWindow(boundary: TranscriptBoundary, source: ChatMessage): boolean {
  const windowed = source.metadata?.window
  if (!windowed || (windowed.omittedBefore === 0 && windowed.omittedAfter === 0)) return true
  const keys = contentKeys(source.content)
  const folded = source.content.some(block => block.type === 'notice' && block.fold)
  if (!boundary.cursor) {
    if (windowed.omittedBefore === 0) return true
    const named = Object.keys(boundary.content ?? {})
    if (!named.length) return false
    return folded || named.some(key => keys.includes(key))
  }
  // A missing anchor stays hidden unless a fold or block ends immediately
  // before it. Any fold at all used to count, which pinned the chip to the
  // start of the tail once the anchor block had been dropped.
  const atMissing = boundary.at !== undefined && !keys.includes(boundary.at)
  if (atMissing && coverBeforeCut(source.content, boundary.at!) === null) return false
  const items = source.metadata?.codex?.items ?? []
  if (boundary.atItem !== undefined && !items.some(item => item.id === boundary.atItem)
    && (boundary.at === undefined || atMissing)) return false
  if (boundary.at !== undefined && !atMissing && windowed.omittedBefore > 0) {
    const index = keys.indexOf(boundary.at)
    const start = contentKeyStamp(source.content[index])?.start ?? 0
    if (index === 0 && (boundary.offset ?? 0) < start) return false
  }
  return true
}

/** `end`: the cut is past every current block. `null`: one edge cannot say where the cut is. */
function prefixEdge(
  map: Record<string, number>,
  keys: readonly string[],
  texts: readonly (string | undefined)[],
): { key: string; offset: number } | 'end' | null {
  const firstAt = new Map<string, number>()
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    if (!firstAt.has(key)) firstAt.set(key, index)
  }
  let partial: { key: string; offset: number } | null = null
  for (let index = 0; index < keys.length; index++) {
    // A repeated id is the same block. Only its first copy decides the edge.
    if (firstAt.get(keys[index]) !== index) continue
    const key = keys[index]
    const saved = map[key]
    const text = texts[index]
    if (saved === undefined) {
      const edge = partial ?? { key, offset: 0 }
      const edgeAt = partial ? firstAt.get(partial.key)! : index
      for (let later = edgeAt + 1; later < keys.length; later++) {
        if (firstAt.get(keys[later]) !== later) continue
        if (map[keys[later]] !== undefined) return null
      }
      return edge
    }
    if (text !== undefined && saved < text.length) {
      if (partial || saved < 0) return null
      partial = { key, offset: saved }
      continue
    }
    if (partial) return null
  }
  return partial ?? 'end'
}

/**
 * Blocks still in the window that end immediately before a cursor anchor the
 * slice no longer holds. Empty when the prefix is gone or a gap remains, so
 * the marker stays hidden instead of jumping to the start of the tail.
 */
function coverBeforeCut(content: readonly ContentBlock[], at: string): Record<string, number> | null {
  const parsed = /^(.*):(\d+)$/.exec(at)
  if (!parsed) return null
  const kind = parsed[1]
  const target = Number(parsed[2])
  const keys = contentKeys(content)
  const counts = new Map<string, number>()
  const map: Record<string, number> = {}
  let pending: Array<{ key: string; length: number }> = []
  const flush = () => {
    for (const item of pending) map[item.key] = item.length
    pending = []
  }
  // The chip sits here only when the held blocks account for every ordinal
  // before `at`. A fold that says nothing about that kind is not proof.
  const placed = (): Record<string, number> | null =>
    (counts.get(kind) ?? 0) === target && Object.keys(map).length ? map : null

  for (let index = 0; index < content.length; index++) {
    const block = content[index]
    const key = keys[index]
    if (block.type === 'notice' && block.fold) {
      const running = counts.get(kind) ?? 0
      const declared = /^(.*):(\d+)$/.exec(block.fold.contentKey)
      const start = declared?.[1] === kind ? Number(declared[2]) : running
      const count = block.fold.keyCounts?.[kind] ?? 0
      for (const [name, value] of Object.entries(block.fold.keyCounts ?? {})) {
        if (name === kind) continue
        counts.set(name, (counts.get(name) ?? 0) + value)
      }
      if (count === 0) {
        if (key) pending.push({ key, length: -1 })
        continue
      }
      if (target < start || target < start + count) return target < start ? placed() : null
      flush()
      if (key) map[key] = -1
      counts.set(kind, Math.max(running, start + count))
      if ((counts.get(kind) ?? 0) >= target) return placed()
      continue
    }
    const stamped = contentKeyStamp(block)
    const ordinal = stamped ? /^(.*):(\d+)$/.exec(stamped.key) : null
    const blockKind = ordinal ? ordinal[1] : !stamped && !isToolUseBlock(block) && !isToolResultBlock(block) ? contentKeyKind(block) : null
    const blockN = ordinal ? Number(ordinal[2]) : blockKind ? counts.get(blockKind) ?? 0 : null
    if (blockKind !== null && blockN !== null) {
      if (blockKind === kind && blockN >= target) return placed()
      counts.set(blockKind, Math.max(counts.get(blockKind) ?? 0, blockN + 1))
      if (blockKind === kind) {
        flush()
        const text = blockText(block)
        if (key) map[key] = text === undefined ? -1 : text.length
        continue
      }
    }
    const text = blockText(block)
    if (key) pending.push({ key, length: text === undefined ? -1 : text.length })
  }
  return placed()
}

function edgeMap(
  keys: readonly string[],
  texts: readonly (string | undefined)[],
  at: string | undefined,
  offset: number,
  origins?: readonly (ContentKeyStamp | undefined)[],
): Record<string, number> {
  const map: Record<string, number> = {}
  const end = at === undefined ? keys.length : keys.indexOf(at)
  if (end < 0) return map
  for (let index = 0; index < end; index++) {
    const key = keys[index]
    const text = texts[index]
    if (key === undefined) continue
    map[key] = text === undefined ? -1 : text.length
  }
  if (at === undefined) return map
  const key = keys[end]
  const text = texts[end]
  const origin = origins?.[end]
  // A slice's text starts at `origin.start` in the whole block, after a render prefix that is not part of that text.
  const relative = origin ? origin.prefix + offset - origin.start : offset
  // A fold notice or a tool has no character offset. A positive offset would pull the whole block above the cut.
  if (key !== undefined && text !== undefined && relative > 0) map[key] = relative
  return map
}

/** Resolve saved async-answer cursors to whole block edges, including their later streaming deltas. */
export function resolveTranscriptBoundaries(cuts: readonly ChatMessage[], lengths: Pick<TranscriptBoundary, 'content' | 'items'>): TranscriptBoundary[] {
  let previous: Pick<TranscriptBoundary, 'content' | 'items'> = { content: {}, items: {} }
  return cuts.map(cut => {
    const cursor = cut.metadata!.transcriptBoundary!
    const asyncAnswer = isCodexAsyncAnswer(cut)
    const resolved = { ...cursor, content: { ...previous.content }, items: { ...previous.items } }
    for (const kind of ['content', 'items'] as const) {
      for (const [key, offset] of Object.entries(cursor[kind])) {
        const end = asyncAnswer ? lengths[kind][key] ?? offset : offset
        // A later compaction cannot replay text consumed by a whole-block answer boundary.
        resolved[kind][key] = Math.max(previous[kind][key] ?? -1, end)
      }
    }
    previous = resolved
    return resolved
  })
}

export function captureTranscriptBoundary(message: ChatMessage, messages: readonly ChatMessage[] = []): TranscriptBoundary {
  let order = capturedOrders.get(message.id) ?? 0
  for (const row of messages) {
    const cursor = row.metadata?.transcriptBoundary
    if (cursor?.messageId === message.id) order = Math.max(order, cursor.order)
  }
  order += 1
  capturedOrders.delete(message.id)
  capturedOrders.set(message.id, order)
  if (capturedOrders.size > 1024) capturedOrders.delete(capturedOrders.keys().next().value!)
  return {
    messageId: message.id,
    order,
    ...transcriptLengths(message),
  }
}

/** Capture accepted async answers before any continuation can arrive. */
export function anchorAsyncAnswer(message: ChatMessage, messages: readonly ChatMessage[]): ChatMessage {
  if (!isCodexAsyncAnswer(message) || message.metadata?.transcriptBoundary) return message
  const itemId = message.id.slice('codex_async_answer:'.length)
  const source = messages.findLast(row => row.status === 'streaming' && row.role === 'assistant'
    && codexAsyncQuestionItems(row).some(item => item.id === itemId))
    ?? messages.findLast(row => row.status === 'streaming' && row.role === 'assistant' && row.providerId === 'codex')
  return source ? { ...message, metadata: { ...message.metadata, transcriptBoundary: captureTranscriptBoundary(source, messages) } } : message
}
