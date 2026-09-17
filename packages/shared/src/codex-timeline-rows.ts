import type { AgentEvent, ChatMessage } from './agent-types'
import { applySeqToMessage } from './event-seq-utils'

/** Carry the event's sequence onto a Codex timeline row that has no provider order yet. */
export function stampCodexTimelineOrder(message: ChatMessage, event: AgentEvent): ChatMessage {
  const timeline = message.metadata?.codexTimeline
  return {
    ...message,
    ...applySeqToMessage(event),
    ...(timeline && event.seq !== undefined
      ? {
          metadata: {
            ...message.metadata,
            codexTimeline: {
              ...timeline,
              localOrder: timeline.localOrder ?? event.seq,
            },
          },
        }
      : {}),
  }
}

function codexTurnId(message: ChatMessage): string | undefined {
  return message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
}

/**
 * Place a Codex timeline row in transcript order.
 *
 * Codex announces `turn/started` before the turn's `userMessage` item, so the
 * assistant row is already in the transcript when the voice agent's delegation
 * prompt arrives — and a mid-turn steer arrives while the assistant is streaming.
 * The provider timeline lists every user prompt of a turn ahead of its assistant
 * row; matching that here keeps the live thread and the restored one in the same
 * order. The prompt inherits the assistant row's order so both orderings agree.
 */
export function insertCodexTimelineRow(messages: readonly ChatMessage[], message: ChatMessage): ChatMessage[] {
  const turnId = message.role === 'user' ? codexTurnId(message) : undefined
  const anchor = turnId === undefined
    ? -1
    : messages.findIndex((existing) => existing.role === 'assistant' && codexTurnId(existing) === turnId)
  if (anchor === -1) return [...messages, message]
  const anchorOrder = messages[anchor].metadata?.codexTimeline?.localOrder
  const timeline = message.metadata?.codexTimeline
  const placed = timeline && anchorOrder !== undefined
    ? { ...message, metadata: { ...message.metadata, codexTimeline: { ...timeline, localOrder: anchorOrder } } }
    : message
  return [...messages.slice(0, anchor), placed, ...messages.slice(anchor)]
}
