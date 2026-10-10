import type { AgentStatus, ChatMessage, RealtimeTimelineSegment } from './agent-types'
import { buildRealtimeConversationTurns, realtimeSegmentsToMessage, selectRealtimeSegments, suppressRealtimeStartupEcho } from './realtime-transcript'
import { buildRealtimeTranscriptLayout, mapRealtimeTurnActivities, type RealtimeTurnActivity } from './realtime-turn-activities'

export interface ProjectedRealtimeActivity {
  turnId: string
  afterMessageId: string | null
  activity: RealtimeTurnActivity
}

/** Use the desktop's turn boundaries, activity ownership and live-edge placement. */
export function projectRealtimeTranscript(input: {
  messages: readonly ChatMessage[]
  segments: readonly RealtimeTimelineSegment[]
  liveSegments: readonly RealtimeTimelineSegment[]
  sessionStatus: AgentStatus
  needsDecision: boolean
}): { messages: ChatMessage[]; activities: ProjectedRealtimeActivity[] } {
  const selected = selectRealtimeSegments(input.segments, input.liveSegments)
  const turns = buildRealtimeConversationTurns(suppressRealtimeStartupEcho(input.messages, selected.segments))
  const activities = mapRealtimeTurnActivities({ ...input, turns })
  const messages: ChatMessage[] = []
  const projected: ProjectedRealtimeActivity[] = []
  const tailIds = new Map<string, string>()
  for (const turn of turns) {
    const rows = [
      ...(turn.user?.text.trim() ? [realtimeSegmentsToMessage([turn.user], selected.liveItems)] : []),
      ...(turn.assistant.some(item => item.text.trim()) ? [realtimeSegmentsToMessage(turn.assistant, selected.liveItems)] : []),
    ]
    messages.push(...rows)
    if (rows.length) tailIds.set(turn.id, rows.at(-1)!.id)
  }
  for (const row of buildRealtimeTranscriptLayout(turns, activities)) {
    if (row.kind !== 'activity') continue
    const activity = activities.get(row.turnId)!
    projected.push({ turnId: row.turnId, activity,
      afterMessageId: activity.status === 'working' ? null : tailIds.get(row.turnId) ?? null })
  }
  return { messages, activities: projected }
}
