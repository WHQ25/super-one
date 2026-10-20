import type { AgentEvent, ChatMessage, MessageMetadata } from '@superone/shared/agent-types'
import { projectProgressiveMessage } from './projection'
import { revealTodoResults, stripMessagesForRemote } from './remote-content'

/**
 * A message as transcript windows cut it: the phone projection (bodies behind
 * detail refs, thumbnails, compact results) with text left whole, the way live
 * text reaches a phone. Every host serves the same projection, whatever its
 * connection's own surface, so a routing desktop can relay a node's window.
 */
export function projectWindowMessage(message: ChatMessage): ChatMessage {
  // Todo items come from the original call. Shelling first would blank that input, and the row would carry an empty list.
  return stripMessagesForRemote([projectProgressiveMessage(revealTodoResults(message))], undefined, { splitText: false })[0]
}

/** Text-like deltas: their content reaches a window holder as fragment patches. */
const WINDOW_TEXT_DELTAS = new Set(['text', 'thinking', 'plan', 'review', 'notice'])
/** Events that only change transcript content. */
const WINDOW_CONTENT_EVENTS = new Set<AgentEvent['type']>([
  'content_retracted', 'message_timestamp', 'suggested_task_updated', 'checkpoint_captured',
])

/**
 * A live event for a connection that holds a transcript window of its session:
 * null when the event only changes content (the window patch carries that), or
 * the event with message bodies removed when it also changes session state.
 */
export function windowLiveEvent(event: AgentEvent): AgentEvent | null {
  if (WINDOW_CONTENT_EVENTS.has(event.type)) return null
  switch (event.type) {
    case 'transcript_replaced': {
      // The patch owns the replacement rows; the reducer only needs the last reply pointer.
      const reply = event.messages.findLast(message => message.role === 'assistant')
      return { ...event, messages: reply ? [{ id: reply.id, role: reply.role, status: reply.status,
        createdAt: reply.createdAt, providerId: reply.providerId, content: [] }] : [] }
    }
    case 'content_delta': {
      if (!WINDOW_TEXT_DELTAS.has(event.delta.type)) return event
      // An async question rides on its text; its pending state does not live in the transcript.
      if (event.delta.type === 'text' && event.delta.codexAsyncQuestions?.length) return { ...event, delta: { ...event.delta, text: '' } }
      return null
    }
    case 'message_start':
    case 'user_message_appended': {
      const { attachments: _attachments, ...message } = event.message
      return { ...event, message: { ...message, content: [] } }
    }
    case 'message_complete':
    case 'message_interrupted':
    case 'message_error':
      return event.metadata ? { ...event, metadata: lightLiveMetadata(event.metadata) } : event
    default:
      return event
  }
}

function lightLiveMetadata(metadata: MessageMetadata): MessageMetadata {
  const { resultText: _resultText, ...light } = metadata
  if (light.codex) {
    const { finalResponse: _finalResponse, ...codex } = light.codex
    light.codex = { ...codex, items: [] }
  }
  return light
}
