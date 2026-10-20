import type { ChatMessage, ContentBlock, CodexThreadItem } from './agent-types'
import { codexAsyncQuestionItems, isCodexAsyncAnswer } from './codex-async-question'
import { isToolResultBlock, isToolUseBlock } from './content-delta'

/** A durable cursor into a provider message, whose identity never changes. */
export interface TranscriptBoundary {
  messageId: string
  order: number
  content: Record<string, number>
  items: Record<string, number>
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
