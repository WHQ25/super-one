import { describe, expect, it } from 'vitest'
import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { buildRealtimeConversationTurns } from './realtime-conversation-turns'
import { buildRealtimeTranscriptLayout, mapRealtimeTurnActivities } from './realtime-turn-activities'

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

function normal(id: string, role: ChatMessage['role'], order: number): ChatMessage {
  return {
    id,
    role,
    status: 'complete',
    content: [{ type: 'text', text: id }],
    createdAt: '',
    providerId: 'codex',
    metadata: { codexTimeline: { provenance: 'codex', position: order } },
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

  it('renders newer voice turns before an earlier activity that is still working', () => {
    const turns = buildRealtimeConversationTurns([
      segment('user-1', 'user', 10),
      segment('assistant-1', 'assistant', 15),
      segment('user-2', 'user', 30),
      segment('assistant-2', 'assistant', 40),
    ])
    const activities = mapRealtimeTurnActivities({
      turns,
      messages: [work('work-1', 'turn-a', 20)],
      sessionStatus: 'background',
      needsDecision: false,
    })

    expect(buildRealtimeTranscriptLayout(turns, activities)).toEqual([
      { kind: 'voice', turnId: 'user-1' },
      { kind: 'voice', turnId: 'user-2' },
      { kind: 'activity', turnId: 'user-1' },
    ])
  })

  it('keeps ordinary Codex turns around the voice portion of a mixed thread', () => {
    const turns = buildRealtimeConversationTurns([
      segment('voice-user', 'user', 10),
      segment('voice-assistant', 'assistant', 15),
    ])
    const messages = [
      normal('typed-before-user', 'user', 1),
      normal('typed-before-assistant', 'assistant', 2),
      work('voice-work', 'turn-a', 20),
      normal('typed-after-user', 'user', 30),
      normal('typed-after-assistant', 'assistant', 31),
    ]
    const activities = mapRealtimeTurnActivities({
      turns,
      messages,
      sessionStatus: 'idle',
      needsDecision: false,
    })

    expect(buildRealtimeTranscriptLayout(turns, activities, messages)).toEqual([
      { kind: 'message', messageId: 'typed-before-user' },
      { kind: 'message', messageId: 'typed-before-assistant' },
      { kind: 'voice', turnId: 'voice-user' },
      { kind: 'activity', turnId: 'voice-user' },
      { kind: 'message', messageId: 'typed-after-user' },
      { kind: 'message', messageId: 'typed-after-assistant' },
    ])
  })

  it('uses timestamps to keep unpositioned local user rows around a new voice call', () => {
    const turns = buildRealtimeConversationTurns([{
      ...segment('voice-user', 'user', 10),
      startedAtMs: 2_000,
    }])
    const before = { ...normal('before', 'user', 1), createdAt: new Date(1_000).toISOString(), metadata: undefined }
    const after = { ...normal('after', 'user', 2), createdAt: new Date(3_000).toISOString(), metadata: undefined }

    expect(buildRealtimeTranscriptLayout(turns, new Map(), [before, after])).toEqual([
      { kind: 'message', messageId: 'before' },
      { kind: 'voice', turnId: 'voice-user' },
      { kind: 'message', messageId: 'after' },
    ])
  })
})
