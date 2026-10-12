import type { ChatMessage } from '@superone/shared/agent-types'

export function findCheckpointTarget(messages: ChatMessage[], assistantMessageId: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].id !== assistantMessageId) continue
    for (let j = i - 1; j >= 0; j--) {
      if (messages[j].role === 'user') return j
    }
    break
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
}
