import type { ChatMessage } from './agent-types'

/** Native inputs can share an assistant turn; their explicit user id wins. */
export function findCheckpointTarget(messages: ChatMessage[], assistantMessageId: string, userMessageId?: string): number {
  if (userMessageId) return messages.findIndex((message) => message.id === userMessageId && message.role === 'user')
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id !== assistantMessageId) continue
    for (let j = i - 1; j >= 0; j--) if (messages[j].role === 'user') return j
    break
  }
  return messages.findLastIndex((message) => message.role === 'user')
}
