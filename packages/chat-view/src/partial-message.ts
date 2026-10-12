import type { ChatMessage } from '@superone/shared/agent-types'
import { requestNativeAsync } from './bridge'

/** A transcript window holds only part of this message; its text is not the whole reply. */
export function isPartialMessage(message: ChatMessage): boolean {
  return message.metadata?.window !== undefined
}

/** The whole message for copy: a partial row fetches it from the host, a complete one is itself. */
export async function wholeMessage(message: ChatMessage): Promise<ChatMessage> {
  if (!isPartialMessage(message)) return message
  const result = await requestNativeAsync('loadFullMessage', { messageId: message.id }) as { message?: ChatMessage }
  if (!result?.message || !Array.isArray(result.message.content)) throw new Error('Message unavailable')
  return result.message
}
