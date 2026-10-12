import type { ChatMessage, ContentBlock, CodexThreadItem } from './agent-types'
import { blockText, contentKeys, itemText, type TranscriptBoundary } from './transcript-boundary'
import { isToolResultBlock, isToolUseBlock } from './content-delta'
import { isDismissedCodexAsyncAnswer } from './codex-async-question'

export interface TranscriptSegment {
  id: string
  message: ChatMessage
  /** Provider row used to load history and request tool details. */
  source: ChatMessage
  final: boolean
  anchorId: string
  offset: number
}

const cachedSegments = new WeakMap<ChatMessage, { cuts: ChatMessage[]; segments: TranscriptSegment[] }>()

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

/** Pure display projection: provider messages stay intact for events and persistence. */
export function transcriptSegments(messages: readonly ChatMessage[]): TranscriptSegment[] {
  // A dismissed question closes the decision queue without creating a visible
  // bubble or cutting the assistant's continuing output at its saved cursor.
  const displayed = messages.filter(message => !isDismissedCodexAsyncAnswer(message, messages))
  const sources = new Set(displayed.map(message => message.id))
  const boundaries = new Map<string, ChatMessage[]>()
  const consumed = new Set<string>()
  for (const message of displayed) {
    const cursor = message.metadata?.transcriptBoundary
    if (!cursor || !sources.has(cursor.messageId) || cursor.messageId === message.id) continue
    const rows = boundaries.get(cursor.messageId) ?? []
    rows.push(message)
    boundaries.set(cursor.messageId, rows)
    consumed.add(message.id)
  }
  const result: TranscriptSegment[] = []
  for (const source of displayed) {
    if (consumed.has(source.id)) continue
    if (source.role !== 'assistant' || source.providerId === 'system') {
      const cursor = source.metadata?.transcriptBoundary
      result.push({ id: source.id, message: source, source, final: true,
        anchorId: cursor?.messageId ?? source.id, offset: cursor?.order ?? 0 })
      continue
    }
    const cuts = (boundaries.get(source.id) ?? []).sort((a, b) => a.metadata!.transcriptBoundary!.order - b.metadata!.transcriptBoundary!.order)
    const cached = cachedSegments.get(source)
    if (cached && cached.cuts.length === cuts.length && cached.cuts.every((cut, index) => cut === cuts[index])) {
      result.push(...cached.segments)
      continue
    }
    const keys = contentKeys(source.content)
    const keyByBlock = new Map(source.content.map((block, index) => [block, keys[index]]))
    const firstResult = result.length
    let previous: ChatMessage | undefined
    for (let part = 0; part <= cuts.length; part++) {
      const next = cuts[part]
      const slice = interval(source, previous?.metadata?.transcriptBoundary, next?.metadata?.transcriptBoundary)
      const groups = source.metadata?.codex ? itemGroups(slice.items).map((items, index, all) => ({ items, content: index === all.length - 1 ? slice.content : [] }))
        : contentGroups(slice.content).map(content => ({ content, items: [] as CodexThreadItem[] }))
      for (let group = 0; group < groups.length; group++) {
        const value = groups[group]
        // Empty continuations retain the footer immediately after a boundary.
        if (!value.content.length && !value.items.length && next) continue
        const key = value.items[0]?.id ?? keyByBlock.get(value.content[0]) ?? `part-${part}`
        const id = result.length === firstResult ? source.id
          : previous && group === 0 ? `${source.id}:after:${previous.id}` : `${source.id}:segment:${key}`
        const anchorId = source.id
        const offset = (previous ? previous.metadata!.transcriptBoundary!.order + 0.1 : 0) + group / (groups.length + 1) * 0.5
        result.push({ id, source, final: false, anchorId, offset, message: { ...source, status: 'complete', content: value.content,
          metadata: { ...source.metadata, ...(source.metadata?.codex ? { codex: { ...source.metadata.codex, items: value.items, finalResponse: undefined } } : {}) } } })
      }
      if (next) result.push({ id: next.id, message: next, source: next, final: true,
        anchorId: source.id, offset: next.metadata!.transcriptBoundary!.order })
      previous = next
    }
    const last = result.findLast(segment => segment.source === source)
    if (last) {
      last.final = true
      last.message = { ...last.message, status: source.status }
    }
    cachedSegments.set(source, { cuts, segments: result.slice(firstResult) })
  }
  return result
}
