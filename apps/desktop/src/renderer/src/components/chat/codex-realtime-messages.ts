import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import {
  isRealtimeDelegationMessage,
  isRealtimeVoiceMessage,
  realtimeSegmentsToMessage,
  segmentKey,
  suppressRealtimeStartupEcho,
} from '@superone/shared/realtime-transcript'
import type { CodexRealtimeSessionViewState } from '@/stores/codex-realtime-view'

// The projection itself is shared with the phone, which shows the same spoken turns
// in a single read-only transcript. Only the store-bound selectors stay here.
export { isRealtimeDelegationMessage, isRealtimeVoiceMessage, realtimeSegmentsToMessage }

function threadMessageKey(message: ChatMessage): string {
  const turnId = message.metadata?.codexTimeline?.turnId ?? message.metadata?.codex?.turnId
  return message.role === 'assistant' && turnId ? `turn:${turnId}` : `message:${message.id}`
}

export interface CodexThreadMergeOptions {
  /**
   * Keep the `<realtime_delegation>` prompts the voice agent injected into the thread.
   * The voice view drops them — it already says the same thing in speech — but the
   * backing-thread view exists to show exactly what Codex was asked to do.
   */
  keepDelegationPrompts?: boolean
}

/**
 * Build the backing Codex Thread without realtime transcript items. Provider timeline
 * copies supply restored history while live chat-store messages overlay matching turns.
 */
export function mergeCodexThreadMessages(
  messages: readonly ChatMessage[],
  realtime: Pick<CodexRealtimeSessionViewState, 'threadMessages'>,
  options: CodexThreadMergeOptions = {},
): ChatMessage[] {
  const drop = (message: ChatMessage): boolean => (
    isRealtimeVoiceMessage(message)
    || (!options.keepDelegationPrompts && isRealtimeDelegationMessage(message))
  )
  const merged = realtime.threadMessages.filter((message) => !drop(message))
  const indexes = new Map(merged.map((message, index) => [threadMessageKey(message), index]))

  for (const message of messages) {
    if (drop(message)) continue
    const key = threadMessageKey(message)
    const existingIndex = indexes.get(key)
    if (existingIndex === undefined) {
      indexes.set(key, merged.length)
      merged.push(message)
      continue
    }
    const canonical = merged[existingIndex]
    merged[existingIndex] = {
      ...message,
      id: canonical.id,
      metadata: {
        ...canonical.metadata,
        ...message.metadata,
        codexTimeline: canonical.metadata?.codexTimeline ?? message.metadata?.codexTimeline,
      },
    }
  }
  return merged
}

/** Realtime-only transcript in stable provider/local order, including live deltas. */
export function selectRealtimeTranscript(
  realtime: CodexRealtimeSessionViewState,
): RealtimeTimelineSegment[] {
  const byId = new Map<string, RealtimeTimelineSegment>()
  for (const segment of realtime.segments) byId.set(segmentKey(segment), segment)
  for (const item of realtime.liveItems) {
    if (!item.done || item.text.length === 0) continue
    const segment: RealtimeTimelineSegment = {
      id: `live-${item.itemId}`,
      sourceItemId: item.itemId,
      realtimeSessionId: item.realtimeSessionId,
      role: item.role,
      text: item.text,
      provenance: item.role === 'assistant' ? 'realtime-assistant' : 'realtime-user',
      ...(item.localOrder === undefined ? {} : { localOrder: item.localOrder }),
      ...(item.startedAtMs === undefined ? {} : { startedAtMs: item.startedAtMs }),
    }
    byId.set(item.itemId, { ...byId.get(item.itemId), ...segment })
  }
  return [...byId.values()].sort((left, right) => (
    (left.position ?? left.localOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.position ?? right.localOrder ?? Number.MAX_SAFE_INTEGER)
  ))
}

export function realtimeSegmentToMessage(segment: RealtimeTimelineSegment): ChatMessage {
  return realtimeSegmentsToMessage([segment])
}

/** Backward-compatible name for callers that need only the foreground voice line. */
export function mergeCodexRealtimeMessages(
  messages: readonly ChatMessage[],
  realtime: CodexRealtimeSessionViewState,
): ChatMessage[] {
  return suppressRealtimeStartupEcho(messages, selectRealtimeTranscript(realtime))
    .map(realtimeSegmentToMessage)
}
