import { codexAsyncAnswerQuestions, isCodexAsyncAnswer } from './codex-async-question'
import type { ChatMessage } from './agent-types'
import { transcriptSegments, type TranscriptSegment } from './transcript-segments'

export interface TurnOutlineEntry {
  id: string
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
    const fallback = message.content.flatMap(block => block.type === 'text' ? [block.text.slice(0, 160)] : []).join('\n').trim()
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

export function extractTurnOutline(messages: readonly ChatMessage[], segments: readonly TranscriptSegment[] = transcriptSegments(messages)): TurnOutlineEntry[] {
  const positions = new Map(messages.map((message, index) => [message.id, index]))
  const entries: TurnOutlineEntry[] = []
  let open: TurnOutlineEntry | null = null
  for (const segment of segments) {
    const message = segment.message
    if (message.providerId === 'system' || (message.role !== 'user' && message.role !== 'assistant')) continue
    const text = textOf(message) || message.content.flatMap(block => 'toolName' in block ? [block.toolName] : []).join('\n')
    if (!text) continue
    const entry: TurnOutlineEntry = {
      id: segment.id, messageId: segment.source.id, messageIndex: positions.get(segment.source.id)!,
      anchorId: segment.anchorId, offset: segment.offset,
      index: positions.get(segment.anchorId) ?? positions.get(segment.source.id)!,
      text, createdAt: message.createdAt,
    }
    if (message.role === 'user') open = entry
    else if (open && open.reply === undefined) open.reply = text
    entries.push(entry)
  }
  return entries
}
