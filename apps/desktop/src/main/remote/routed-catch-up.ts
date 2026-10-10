import type { AgentEvent, ChatMessage, ContentBlock } from '@superone/shared/agent-types'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The streamed text of a block whose text only grows, or null for any other block. */
function growingText(block: ContentBlock): string | null {
  if (block.type === 'text') return block.text
  if (block.type === 'thinking') return block.thinking
  return null
}

function terminal(message: ChatMessage): AgentEvent | null {
  if (message.status === 'complete') return { type: 'message_complete', messageId: message.id, ...(message.metadata ? { metadata: message.metadata } : {}) }
  if (message.status === 'interrupted') return { type: 'message_interrupted', messageId: message.id }
  if (message.status === 'error') {
    const info = message.metadata?.errorInfo
    return { type: 'message_error', messageId: message.id, error: info?.raw ?? 'error', ...(info ? { errorInfo: info } : {}), ...(message.metadata ? { metadata: message.metadata } : {}) }
  }
  return null
}

/**
 * The events that bring a phone from the messages it has to the node's
 * snapshot, using only what its reducer already applies: a new message whole,
 * the blocks a message is missing, the rest of a block still streaming, and
 * the message's end. Null when the phone's messages are not a prefix of the
 * snapshot's (it must reopen the session).
 */
export function catchUpEvents(have: readonly ChatMessage[], want: readonly ChatMessage[]): AgentEvent[] | null {
  const events: AgentEvent[] = []
  for (const message of want) {
    const held = have.find((m) => m.id === message.id)
    if (!held) {
      events.push({ type: 'message_start', message })
      continue
    }
    if (held.status === message.status && same(held.content, message.content)) continue
    if (held.content.length > message.content.length) return null
    for (let i = 0; i < message.content.length; i++) {
      const target = message.content[i]!
      const current = held.content[i]
      if (!current) {
        events.push({ type: 'content_delta', messageId: message.id, delta: target })
        continue
      }
      if (same(current, target)) continue
      const from = growingText(current)
      const to = growingText(target)
      // Only the last held block may still be streaming.
      if (i !== held.content.length - 1 || from === null || to === null || !to.startsWith(from) || current.type !== target.type) return null
      const rest = to.slice(from.length)
      events.push({ type: 'content_delta', messageId: message.id, delta: target.type === 'text' ? { ...target, text: rest } : { ...target, thinking: rest } as ContentBlock })
    }
    if (held.status !== message.status) {
      const end = terminal(message)
      if (end) events.push(end)
    }
  }
  return events
}
