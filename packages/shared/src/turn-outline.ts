import { codexAsyncAnswerQuestions, isCodexAsyncAnswer } from './codex-async-question'
import type { ChatMessage } from './agent-types'
import { parseCompactMarker } from './transcript-markers'
import { transcriptSegments, type TranscriptSegment } from './transcript-segments'

export interface TurnOutlineEntry {
  id: string
  /** A compaction point; its label comes from the client's translations. */
  kind?: 'compact'
  index: number
  text: string
  createdAt: string
  reply?: string
  messageId?: string
  messageIndex?: number
  anchorId?: string
  offset?: number
}

function textOf(message: ChatMessage): string {
  if (isCodexAsyncAnswer(message)) {
    const questions = codexAsyncAnswerQuestions(message, [])
    if (questions?.length) return questions.map(q => q.title).join('\n')
  }
  const items = message.metadata?.codex?.items
  if (items?.length) {
    const text = items.flatMap(item => item.type === 'agent_message' && item.delivery !== 'async' ? [item.text.slice(0, 160)] : []).join('\n').trim()
    if (text) return text
    // The stored final response: a client also holds the content derived from the items.
    const fallback = message.content.flatMap(block => block.type === 'text' && block.id === undefined ? [block.text.slice(0, 160)] : []).join('\n').trim()
    if (fallback) return fallback
    return items.flatMap(item => item.type === 'command_execution' ? [item.command.slice(0, 160)]
      : item.type === 'mcp_tool_call' ? [item.tool] : item.type === 'reasoning' ? [item.text.slice(0, 160)] : []).join('\n').trim()
  }
  return message.content
    .map((block) => (block.type === 'text' && !block.parentToolUseId ? block.text.slice(0, 160) : ''))
    .filter(Boolean)
    .join('\n')
    .trim().slice(0, 160)
}

/**
 * One tick per user message and compaction point. Assistant text is never a
 * tick: the first text after an entry previews as that entry's reply.
 */
export function extractTurnOutline(messages: readonly ChatMessage[], segments: readonly TranscriptSegment[] = transcriptSegments(messages)): TurnOutlineEntry[] {
  const positions = new Map(messages.map((message, index) => [message.id, index]))
  const entries: TurnOutlineEntry[] = []
  // Entries since the last user message still waiting for their reply.
  let awaiting: TurnOutlineEntry[] = []
  for (const segment of segments) {
    const message = segment.message
    const compact = parseCompactMarker(message) !== null
    if (message.role === 'assistant' && message.providerId !== 'system') {
      const reply = awaiting.length ? textOf(message) : ''
      if (reply) {
        for (const entry of awaiting) entry.reply = reply
        awaiting = []
      }
      continue
    }
    if (!compact && (message.role !== 'user' || message.providerId === 'system')) continue
    const text = compact ? '' : textOf(message)
    if (!compact && !text) {
      awaiting = []
      continue
    }
    const entry: TurnOutlineEntry = {
      id: segment.id, ...(compact ? { kind: 'compact' as const } : {}),
      messageId: segment.source.id, messageIndex: positions.get(segment.source.id)!,
      anchorId: segment.anchorId, offset: segment.offset,
      index: positions.get(segment.anchorId) ?? positions.get(segment.source.id)!,
      text, createdAt: message.createdAt,
    }
    awaiting = compact ? [...awaiting, entry] : [entry]
    entries.push(entry)
  }
  return entries
}
