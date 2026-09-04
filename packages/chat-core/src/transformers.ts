import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { applySeqToMessage } from '@superone/shared/event-seq-utils'
import type { ChatProvider } from './types'

/** Default harness when a session has not yet recorded `sessionProvider`. */
export const DEFAULT_PROVIDER: ChatProvider = 'claude'

/** Stamp `_lastAppliedSeq` / epoch onto one message. Returns null when the event has no seq. */
export function markMessageEventApplied(
  messages: ChatMessage[],
  messageId: string,
  event: AgentEvent,
): ChatMessage[] | null {
  if (event.seq === undefined) return null
  return messages.map((msg) => (
    msg.id === messageId ? { ...msg, ...applySeqToMessage(event) } : msg
  ))
}

/** Persist accumulated streaming tool-input JSON onto the matching tool_use block. */
export function persistStreamingToolInput(
  messages: ChatMessage[],
  messageId: string,
  toolUseId: string,
  input: string | undefined,
): ChatMessage[] {
  if (input === undefined) return messages
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg
    return {
      ...msg,
      content: msg.content.map((block) => (
        block.type === 'tool_use' && block.toolUseId === toolUseId && block.input !== input
          ? { ...block, input }
          : block
      )),
    }
  })
}
