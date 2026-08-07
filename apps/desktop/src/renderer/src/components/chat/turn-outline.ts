import type { ChatMessage } from '@superone/shared/agent-types'

export interface TurnOutlineEntry {
  id: string
  index: number
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

function isUserTurn(message: ChatMessage): boolean {
  return message.role === 'user' && message.providerId !== 'system'
}

export function extractTurnOutline(messages: ChatMessage[]): TurnOutlineEntry[] {
  const entries: TurnOutlineEntry[] = []
  let open: TurnOutlineEntry | null = null
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (isUserTurn(message)) {
      const text = textOf(message)
      if (!text) {
        open = null
        continue
      }
      open = { id: message.id, index: i, text, createdAt: message.createdAt, reply: undefined }
      entries.push(open)
      continue
    }
    // Skip system markers (compact / turn_summary / recap) — not agent replies.
    if (
      open
      && open.reply === undefined
      && message.role === 'assistant'
      && message.providerId !== 'system'
    ) {
      const replyText = textOf(message)
      if (replyText) open.reply = replyText
    }
  }
  return entries
}
