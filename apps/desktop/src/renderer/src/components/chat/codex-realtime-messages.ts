import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { isRealtimeDelegationText } from '@superone/shared/realtime-timeline'
import type { CodexRealtimeSessionViewState } from '@/stores/codex-realtime-view'

const REALTIME_MESSAGE_ID_PREFIX = 'codex-realtime-'

function realtimeMessageId(segment: Pick<RealtimeTimelineSegment, 'id' | 'sourceItemId'>): string {
  return `${REALTIME_MESSAGE_ID_PREFIX}${segment.sourceItemId ?? segment.id}`
}

function segmentToMessage(
  segment: RealtimeTimelineSegment,
  status: ChatMessage['status'] = 'complete',
): ChatMessage {
  return {
    id: realtimeMessageId(segment),
    role: segment.role,
    status,
    content: [{ type: 'text', text: segment.text }],
    createdAt: '',
    providerId: 'codex',
  }
}

function messageText(message: ChatMessage): string {
  return message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

export function isRealtimeDelegationMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false
  return isRealtimeDelegationText(messageText(message))
}

function messageKey(message: ChatMessage): string {
  const turnId = message.metadata?.codex?.turnId
  return turnId ? `codex-turn:${turnId}` : `message:${message.id}`
}

/**
 * Realtime history and normal Codex turns belong to one provider thread. Use the
 * provider timeline as the ordered scaffold, overlay richer live chat-store messages,
 * then append anything the latest timeline snapshot has not published yet.
 */
export function mergeCodexRealtimeMessages(
  messages: readonly ChatMessage[],
  realtime: CodexRealtimeSessionViewState,
): ChatMessage[] {
  const canonicalIds = new Set(realtime.threadMessages.map((message) => message.id))
  const persistedVoice = realtime.segments
    .map((segment) => segmentToMessage(segment))
    .filter((message) => !canonicalIds.has(message.id))
  const liveVoice = realtime.liveItems
    .filter((item) => item.text.length > 0)
    .map((item) => segmentToMessage({
      id: item.itemId,
      realtimeSessionId: item.realtimeSessionId,
      role: item.role,
      text: item.text,
      ...(item.startedAtMs === undefined ? {} : { startedAtMs: item.startedAtMs }),
    }, item.done ? 'complete' : 'streaming'))
    .filter((message) => !canonicalIds.has(message.id))

  const merged = [...persistedVoice, ...realtime.threadMessages, ...liveVoice]
    .filter((message) => !isRealtimeDelegationMessage(message))
  const indexes = new Map(merged.map((message, index) => [messageKey(message), index]))

  for (const message of messages) {
    if (isRealtimeDelegationMessage(message)) continue
    const key = messageKey(message)
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, merged.length)
      merged.push(message)
    } else {
      merged[existingIndex] = message
    }
  }

  return merged
}
