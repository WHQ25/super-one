import type { ChatMessage, ContentBlock, CodexThreadItem } from './agent-types'
import { blockText, contentKeys, expandBoundaryCursor, itemText, resolveTranscriptBoundaries, transcriptLengths, type TranscriptBoundary } from './transcript-boundary'
import { isToolResultBlock, isToolUseBlock } from './content-delta'
import { isDismissedCodexAsyncAnswer } from './codex-async-question'
import { isLegacyCodexMessage, withCodexContent } from './codex-content'

export interface TranscriptSegment {
  id: string
  message: ChatMessage
  /** Provider row used to load history and request tool details. */
  source: ChatMessage
  final: boolean
  anchorId: string
  offset: number
}

const cachedSegments = new WeakMap<ChatMessage, { cuts: ChatMessage[]; segments: TranscriptSegment[]; rows: TranscriptRow[] }>()

function sliceBlock(block: ContentBlock, from: number, to: number): ContentBlock | null {
  if (from === 0 && to === blockText(block)?.length) return block
  if (block.type === 'text') return to > from ? { ...block, text: block.text.slice(from, to) } : null
  if (block.type === 'thinking') return to > from || ('remoteDetail' in block && block.remoteDetail)
    ? { ...block, thinking: block.thinking.slice(from, to) } : null
  return block
}

function sliceItem(item: CodexThreadItem, from: number, to: number): CodexThreadItem | null {
  if (from === 0 && to === itemText(item)?.length) return item
  if (!('text' in item)) return item
  if (to <= from && !(item.type === 'agent_message' && item.questions?.length)
    && !(item.type === 'reasoning' && item.remoteDetail)) return null
  return { ...item, text: item.text.slice(from, to) }
}

/** Keep calls, results and forwarded children together across text boundaries. */
function contentGroups(content: ContentBlock[]): ContentBlock[][] {
  const groups: ContentBlock[][] = [[]]
  const owners = new Map<string, ContentBlock[]>()
  for (const block of content) {
    const parent = 'parentToolUseId' in block ? block.parentToolUseId : null
    const owner = parent ? owners.get(parent) : isToolResultBlock(block) ? owners.get(block.toolUseId) : undefined
    if (owner) {
      owner.push(block)
      if (isToolUseBlock(block)) owners.set(block.toolUseId, owner)
      continue
    }
    if (block.type === 'text' && !parent && groups.at(-1)!.length) groups.push([])
    const group = groups.at(-1)!
    group.push(block)
    if (isToolUseBlock(block)) owners.set(block.toolUseId, group)
  }
  return groups
}

function itemGroups(items: CodexThreadItem[]): CodexThreadItem[][] {
  const groups: CodexThreadItem[][] = [[]]
  for (const item of items) {
    if (item.type === 'agent_message' && item.delivery !== 'async' && groups.at(-1)!.length) groups.push([])
    groups.at(-1)!.push(item)
  }
  return groups
}

function interval(source: ChatMessage, previous?: TranscriptBoundary, next?: TranscriptBoundary): { content: ContentBlock[]; items: CodexThreadItem[] } {
  const keys = contentKeys(source.content)
  const parents = new Map(source.content.flatMap(block => isToolUseBlock(block) && 'parentToolUseId' in block && block.parentToolUseId
    ? [[block.toolUseId, block.parentToolUseId] as const] : []))
  const rootOwner = (id: string) => {
    const seen = new Set<string>()
    while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id)! }
    return `tool:${id}`
  }
  const content = source.content.flatMap((block, index) => {
    const key = keys[index]
    const ownerKey = 'parentToolUseId' in block && block.parentToolUseId ? rootOwner(block.parentToolUseId)
      : isToolResultBlock(block) ? rootOwner(block.toolUseId) : key
    const start = previous?.content[ownerKey]
    const end = next?.content[ownerKey]
    const text = blockText(block)
    if (ownerKey !== key) return start !== undefined || (next && end === undefined) ? [] : [block]
    if (text === undefined) return start !== undefined || (next && end === undefined) ? [] : [block]
    if (next && end === undefined) return []
    if (start === -1) return []
    if (start !== undefined && text.length <= start) return []
    const value = sliceBlock(block, Math.max(0, start ?? 0), Math.min(text.length, end ?? text.length))
    return value ? [value] : []
  })
  const items = (source.metadata?.codex?.items ?? []).flatMap(item => {
    const start = previous?.items[item.id]
    const end = next?.items[item.id]
    const text = itemText(item)
    if (text === undefined) return start !== undefined || (next && end === undefined) ? [] : [item]
    if (next && end === undefined) return []
    if (start === -1) return []
    if (start !== undefined && text.length <= start) return []
    const value = sliceItem(item, Math.max(0, start ?? 0), Math.min(text.length, end ?? text.length))
    return value ? [value] : []
  })
  return { content, items }
}

/**
 * One drawn transcript row: a whole provider message, or the part of one
 * between two cuts (a compaction or an accepted async answer). The natural
 * text segments inside it are outline targets, not rows, so the turn keeps
 * one body: its spacing, process grouping and footer stay those of one turn.
 */
export interface TranscriptRow {
  id: string
  message: ChatMessage
  source: ChatMessage
  final: boolean
  /** The other segments this row draws, by the block that opens each. */
  anchors?: ReadonlyMap<ContentBlock, string>
  /** Remaining turn after this cut; compact mode must not treat this row's tail as the turn's tail. */
  following?: ChatMessage
  /** First drawn row belonging to this provider turn, even if its opening cut was empty. */
  first?: boolean
}

export interface TranscriptView {
  /** Navigation targets: the outline and jumps address these. */
  segments: TranscriptSegment[]
  rows: TranscriptRow[]
}

/** Pure display projection: provider messages stay intact for events and persistence. */
export function transcriptSegments(messages: readonly ChatMessage[]): TranscriptSegment[] {
  return transcriptView(messages).segments
}

export function transcriptView(messages: readonly ChatMessage[]): TranscriptView {
  // A dismissed question closes the decision queue without creating a visible
  // bubble or cutting the assistant's continuing output at its saved cursor.
  const displayed = messages.filter(message => !isDismissedCodexAsyncAnswer(message, messages))
  const sources = new Set(displayed.map(message => message.id))
  const boundaries = new Map<string, ChatMessage[]>()
  const consumed = new Set<string>()
  for (const message of displayed) {
    const cursor = message.metadata?.transcriptBoundary
    if (!cursor || !sources.has(cursor.messageId) || cursor.messageId === message.id) continue
    const cutRows = boundaries.get(cursor.messageId) ?? []
    cutRows.push(message)
    boundaries.set(cursor.messageId, cutRows)
    consumed.add(message.id)
  }
  const result: TranscriptSegment[] = []
  const rows: TranscriptRow[] = []
  for (const source of displayed) {
    if (consumed.has(source.id)) continue
    if (source.role !== 'assistant' || source.providerId === 'system') {
      const cursor = source.metadata?.transcriptBoundary
      result.push({ id: source.id, message: source, source, final: true,
        anchorId: cursor?.messageId ?? source.id, offset: cursor?.order ?? 0 })
      rows.push({ id: source.id, message: source, source, final: true })
      continue
    }
    const cuts = (boundaries.get(source.id) ?? []).sort((a, b) => a.metadata!.transcriptBoundary!.order - b.metadata!.transcriptBoundary!.order)
    const cached = cachedSegments.get(source)
    if (cached && cached.cuts.length === cuts.length && cached.cuts.every((cut, index) => cut === cuts[index])) {
      result.push(...cached.segments)
      rows.push(...cached.rows)
      continue
    }
    // A window cursor names the cut with one edge. Expand it for the slice only;
    // the drawn compact row keeps the cursor it was sent with.
    const opened = cuts.map(cut => {
      const boundary = cut.metadata?.transcriptBoundary
      if (!boundary?.cursor) return cut
      return { ...cut, metadata: { ...cut.metadata, transcriptBoundary: expandBoundaryCursor(boundary, source) } }
    })
    const cursors = opened.length ? resolveTranscriptBoundaries(opened, transcriptLengths(source)) : []
    // A legacy Codex turn's boundaries index its items, and each segment
    // draws the content its own items derive.
    const legacy = isLegacyCodexMessage(source)
    const segmentOf = (message: ChatMessage): ChatMessage => legacy ? withCodexContent(message) : message
    // Only the stored final response (a text block without an id) is not derived from items.
    const finalResponse = (content: ContentBlock[]) => content.filter(block => block.type === 'text' && block.id === undefined)
    const sliceOf = (content: ContentBlock[], items: CodexThreadItem[]): ChatMessage => segmentOf({ ...source, status: 'complete', content,
      metadata: { ...source.metadata, ...(legacy ? { codex: { ...source.metadata!.codex!, items, finalResponse: undefined } } : {}) } })
    const keys = contentKeys(source.content)
    const keyByBlock = new Map(source.content.map((block, index) => [block, keys[index]]))
    const firstResult = result.length
    const firstRow = rows.length
    let previous: ChatMessage | undefined
    let firstTurnRow = true
    for (let part = 0; part <= cuts.length; part++) {
      const next = cuts[part]
      const slice = interval(source, cursors[part - 1], cursors[part])
      const groups = legacy ? itemGroups(slice.items).map((items, index, all) => ({ items,
        content: index === all.length - 1 ? finalResponse(slice.content) : [] }))
        : contentGroups(slice.content).map(content => ({ content, items: [] as CodexThreadItem[] }))
      const partSegments: { segment: TranscriptSegment; opens: { block?: ContentBlock; itemId?: string } }[] = []
      for (let group = 0; group < groups.length; group++) {
        const value = groups[group]
        // Empty continuations retain the footer immediately after a boundary.
        if (!value.content.length && !value.items.length && next) continue
        const key = value.items[0]?.id ?? keyByBlock.get(value.content[0]) ?? `part-${part}`
        const id = result.length === firstResult ? source.id
          : previous && group === 0 ? `${source.id}:after:${previous.id}` : `${source.id}:segment:${key}`
        const anchorId = source.id
        const offset = (previous ? previous.metadata!.transcriptBoundary!.order + 0.1 : 0) + group / (groups.length + 1) * 0.5
        const segment: TranscriptSegment = { id, source, final: false, anchorId, offset, message: sliceOf(value.content, value.items) }
        result.push(segment)
        partSegments.push({ segment, opens: { block: value.content[0], itemId: value.items[0]?.id } })
      }
      if (partSegments.length) {
        const [first, ...rest] = partSegments
        const message = rest.length ? sliceOf(legacy ? finalResponse(slice.content) : slice.content, slice.items) : first.segment.message
        const anchors = new Map<ContentBlock, string>()
        for (const { segment, opens } of rest) {
          // A legacy segment opens at its first item, which the row derives as a block with that id.
          const block = legacy ? message.content.find(candidate => 'id' in candidate && candidate.id === opens.itemId) : opens.block
          if (block) anchors.set(block, segment.id)
        }
        const following = next ? interval(source, cursors[part]) : undefined
        rows.push({ id: first.segment.id, message, source, final: false, first: firstTurnRow, ...(anchors.size ? { anchors } : {}),
          ...(following ? { following: sliceOf(following.content, following.items) } : {}) })
        firstTurnRow = false
      }
      if (next) {
        result.push({ id: next.id, message: next, source: next, final: true,
          anchorId: source.id, offset: next.metadata!.transcriptBoundary!.order })
        rows.push({ id: next.id, message: next, source: next, final: true })
      }
      previous = next
    }
    const last = result.findLast(segment => segment.source === source)
    const lastRow = rows.findLast(row => row.source === source)
    if (last) {
      const shared = lastRow?.message === last.message
      last.final = true
      last.message = segmentOf({ ...last.message, status: source.status })
      if (shared) lastRow!.message = last.message
    }
    if (lastRow) {
      lastRow.final = true
      if (lastRow.message.status !== source.status) lastRow.message = segmentOf({ ...lastRow.message, status: source.status })
    }
    cachedSegments.set(source, { cuts, segments: result.slice(firstResult), rows: rows.slice(firstRow) })
  }
  return { segments: result, rows }
}
