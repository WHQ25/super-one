import { describe, expect, it } from 'vitest'
import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { buildRealtimeConversationTurns } from './realtime-conversation-turns'
import { mapRealtimeTurnActivities } from './realtime-turn-activities'

const segment = (
  id: string,
  role: RealtimeTimelineSegment['role'],
  order: number,
): RealtimeTimelineSegment => ({ id, realtimeSessionId: 'rt-1', role, text: id, localOrder: order })

function work(id: string, turnId: string, order: number, durationMs = 0): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: id }],
    createdAt: '',
    providerId: 'codex',
    metadata: {
      codex: { threadId: 'thread-1', turnId, usage: null, items: [], durationMs },
      codexTimeline: { provenance: 'realtime-delegated', turnId, localOrder: order },
    },
  }
}

describe('realtime conversation turns', () => {
  it('keeps consecutive assistant segments in one user turn and starts anew on interruption', () => {
    const turns = buildRealtimeConversationTurns([
      segment('user-1', 'user', 10),
      segment('assistant-1a', 'assistant', 20),
      segment('assistant-1b', 'assistant', 30),
      segment('user-interrupt', 'user', 40),
      segment('assistant-2', 'assistant', 50),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]?.assistant.map((item) => item.id)).toEqual(['assistant-1a', 'assistant-1b'])
    expect(turns[1]?.user?.id).toBe('user-interrupt')
  })

  it('aggregates multiple backing Codex turns into the owning voice-turn range', () => {
    const turns = buildRealtimeConversationTurns([
      segment('user-1', 'user', 10),
      segment('assistant-1', 'assistant', 20),
      segment('user-2', 'user', 50),
      segment('assistant-2', 'assistant', 60),
    ])
    const activities = mapRealtimeTurnActivities({
      turns,
      messages: [work('work-1', 'turn-a', 30, 60_000), work('work-2', 'turn-b', 40, 120_000)],
      sessionStatus: 'idle',
      needsDecision: false,
    })

    expect(activities.get('user-1')).toMatchObject({
      status: 'completed',
      durationMs: 180_000,
      messageIds: ['work-1', 'work-2'],
      turnIds: ['turn-a', 'turn-b'],
    })
    expect(activities.has('user-2')).toBe(false)
  })

  it('marks only the latest active range as needing a decision', () => {
    const turns = buildRealtimeConversationTurns([
      segment('user-1', 'user', 10),
      segment('user-2', 'user', 30),
    ])
    const activities = mapRealtimeTurnActivities({
      turns,
      messages: [work('work-1', 'turn-a', 20), work('work-2', 'turn-b', 40)],
      sessionStatus: 'streaming',
      needsDecision: true,
    })

    expect(activities.get('user-1')?.status).toBe('completed')
    expect(activities.get('user-2')?.status).toBe('needs-decision')
  })
})
