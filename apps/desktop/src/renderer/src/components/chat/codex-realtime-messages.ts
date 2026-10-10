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
// in a separate voice transcript. Only the store-bound selectors stay here.
export { isRealtimeDelegationMessage, isRealtimeVoiceMessage, realtimeSegmentsToMessage }

export { mergeCodexThreadMessages, type CodexThreadMergeOptions } from '@superone/shared/realtime-thread-messages'

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
