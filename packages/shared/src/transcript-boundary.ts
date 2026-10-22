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

export function contentKeys(content: readonly ContentBlock[]): string[] {
  const counts = new Map<string, number>()
  return content.map(block => {
    // A window's fold stands where its first block stood and uses up the ordinals of the blocks behind it.
    if (block.type === 'notice' && block.fold) {
      for (const [kind, count] of Object.entries(block.fold.keyCounts ?? {})) counts.set(kind, (counts.get(kind) ?? 0) + count)
      return block.fold.contentKey
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
 * one edge. A map that is not a prefix — an earlier block grew after a later
 * one was captured — is returned unchanged, because one edge would move those
 * later blocks. An already slim cursor is returned as-is: its empty map would
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
  return {
    ...boundary,
    content: edgeMap(contentKeys(source.content), source.content.map(blockText), boundary.at, boundary.offset ?? 0),
    items: edgeMap(items.map(item => item.id), items.map(itemText), boundary.atItem, boundary.itemOffset ?? 0),
    cursor: false,
  }
}

/** `end`: the cut is past every current block. `null`: one edge cannot say where the cut is. */
function prefixEdge(
  map: Record<string, number>,
  keys: readonly string[],
  texts: readonly (string | undefined)[],
): { key: string; offset: number } | 'end' | null {
  let partial: { key: string; offset: number } | null = null
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    const saved = map[key]
    const text = texts[index]
    if (saved === undefined) {
      const edge = partial ?? { key, offset: 0 }
      const edgeAt = partial ? keys.indexOf(partial.key) : index
      for (let later = edgeAt + 1; later < keys.length; later++) {
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

function edgeMap(keys: readonly string[], texts: readonly (string | undefined)[], at: string | undefined, offset: number): Record<string, number> {
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
  // A fold notice or a tool has no character offset. A positive offset would pull the whole block above the cut.
  if (key !== undefined && text !== undefined && offset > 0) map[key] = offset
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
