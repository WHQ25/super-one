import type { AgentEvent, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { dedupeSegmentsByItem, segmentKey } from '@superone/shared/realtime-transcript'
import type { ChatCorePatch, ChatCoreSession } from './types'

/** Live captions are ephemeral; only completed items enter the durable timeline. */
export function reduceRealtime(session: ChatCoreSession, event: AgentEvent): ChatCorePatch {
  if (event.type === 'realtime_started') {
    const realtimeSessionId = event.realtimeSessionId ?? null
    return { realtimeSessionId, realtimeHasTimeline: true, ...(realtimeSessionId === session.realtimeSessionId ? {} : { realtimeLiveSegments: [] }) }
  }
  if (event.type === 'realtime_closed') return { realtimeSessionId: null, realtimeLiveSegments: [] }
  if (event.type !== 'realtime_transcript_item') return {}
  const live = session.realtimeLiveSegments
  const current = live.find(item => segmentKey(item) === event.itemId)
  const realtimeSessionId = event.realtimeSessionId ?? current?.realtimeSessionId ?? session.realtimeSessionId
  if (!realtimeSessionId) return {}
  if (session.realtimeSessionId && realtimeSessionId !== session.realtimeSessionId) return {}
  if (event.phase === 'delta') {
    if (!current || !event.text) return {}
    return { realtimeLiveSegments: live.map(item => item === current ? { ...item, text: item.text + event.text } : item) }
  }
  const role = event.role ?? current?.role
  if (!role) return {}
  const arriving: RealtimeTimelineSegment = {
    ...current,
    id: `live-${event.itemId}`,
    sourceItemId: event.itemId,
    realtimeSessionId,
    role,
    text: event.text,
    provenance: role === 'assistant' ? 'realtime-assistant' : 'realtime-user',
    ...(current?.localOrder === undefined && event.seq !== undefined ? { localOrder: event.seq } : {}),
    ...(event.startedAtMs === undefined ? {} : { startedAtMs: event.startedAtMs }),
  }
  if (event.phase === 'started') {
    // A reconnect can replay an item already present in the restored timeline.
    if (current || session.realtimeSegments.some(item => segmentKey(item) === event.itemId)) return {}
    return { realtimeLiveSegments: [...live, arriving] }
  }
  const remaining = live.filter(item => item !== current)
  if (!arriving.text.trim()) return current ? { realtimeLiveSegments: remaining } : {}
  return {
    realtimeLiveSegments: remaining,
    realtimeSegments: dedupeSegmentsByItem([...session.realtimeSegments, arriving]),
  }
}
