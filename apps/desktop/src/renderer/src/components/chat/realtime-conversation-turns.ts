import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'

export interface RealtimeConversationTurn {
  id: string
  realtimeSessionId: string
  user: RealtimeTimelineSegment | null
  assistant: RealtimeTimelineSegment[]
}

/**
 * A foreground turn follows the spoken interaction, not backing Codex turns. A new
 * user item always opens a turn (including an interruption); every consecutive
 * assistant item stays attached until the user speaks again.
 */
export function buildRealtimeConversationTurns(
  segments: readonly RealtimeTimelineSegment[],
): RealtimeConversationTurn[] {
  const turns: RealtimeConversationTurn[] = []
  let current: RealtimeConversationTurn | null = null

  for (const segment of segments) {
    const newSession = current?.realtimeSessionId !== segment.realtimeSessionId
    if (newSession || segment.role === 'user' || current === null) {
      current = {
        id: segment.sourceItemId ?? segment.id,
        realtimeSessionId: segment.realtimeSessionId,
        user: segment.role === 'user' ? segment : null,
        assistant: segment.role === 'assistant' ? [segment] : [],
      }
      turns.push(current)
      continue
    }
    current.assistant.push(segment)
  }

  return turns
}
