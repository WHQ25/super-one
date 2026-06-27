import type { ChatMessage } from '@superone/shared/agent-types'

export interface TurnOutlineEntry {
  id: string
  text: string
  createdAt: string
  reply?: string
}

function textOf(message: ChatMessage): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function extractTurnOutline(messages: ChatMessage[]): TurnOutlineEntry[] {
  const entries: TurnOutlineEntry[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'user' || message.providerId === 'system') continue
    const text = textOf(message)
    if (!text) continue
    let reply: string | undefined
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]
      if (next.role === 'user' && next.providerId !== 'system') break
      if (next.role === 'assistant') {
        const replyText = textOf(next)
        if (replyText) {
          reply = replyText
          break
        }
      }
    }
    entries.push({ id: message.id, text, createdAt: message.createdAt, reply })
  }
  return entries
}
