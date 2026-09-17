import { describe, expect, it } from 'vitest'
import type { AgentStatus, ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
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

  it.each(['__compact__:auto:900', '__turn_meta__:{"kind":"summary","text":"Still working"}'])(
    'does not treat the system marker %s as a new conversation turn', (text) => {
      const turns = buildRealtimeConversationTurns([segment('voice-user', 'user', 10)])
      const marker: ChatMessage = {
        ...normal('marker', 'assistant', 30), providerId: 'system', content: [{ type: 'text', text }],
      }
      const messages = [work('voice-work', 'voice-turn', 20), marker]

      expect(mapRealtimeTurnActivities({ turns, messages, sessionStatus: 'background', needsDecision: false })
        .get('voice-user')?.status).toBe('working')
      expect(mapRealtimeTurnActivities({ turns, messages, sessionStatus: 'streaming', needsDecision: true })
        .get('voice-user')?.status).toBe('needs-decision')
    },
  )

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

  it.each<[AgentStatus, boolean]>([
    ['streaming', false],
    ['background', false],
    ['streaming', true],
    ['error', false],
    ['idle', false],
  ])('does not apply a later text turn\'s %s status (decision: %s) to completed voice work', (sessionStatus, needsDecision) => {
    const turns = buildRealtimeConversationTurns([
      segment('voice-user', 'user', 10),
      segment('voice-assistant', 'assistant', 15),
    ])
    // Sending the user row alone must detach session-wide status from the old
    // detail, even before the new assistant has started producing a response.
    const messages = [
      work('voice-work', 'voice-turn', 20),
      normal('typed-after-user', 'user', 30),
    ]
    const activities = mapRealtimeTurnActivities({ turns, messages, sessionStatus, needsDecision })

    expect(activities.get('voice-user')?.status).toBe('completed')
    expect(activities.get('voice-user')?.isTail).toBe(false)
    // Typed turns never enter the voice timeline; they belong to the thread view.
    expect(buildRealtimeTranscriptLayout(turns, activities)).toEqual([
      { kind: 'voice', turnId: 'voice-user' },
      { kind: 'activity', turnId: 'voice-user' },
    ])
  })

  it('exposes what the card needs: opening time while working, plan once it settles', () => {
    const turns = buildRealtimeConversationTurns([segment('voice-user', 'user', 10)])
    const running = { ...work('running', 'turn-a', 20), status: 'streaming' as const, createdAt: '2026-09-17T00:00:00.000Z' }
    const working = mapRealtimeTurnActivities({
      turns, messages: [running], sessionStatus: 'streaming', needsDecision: false,
    }).get('voice-user')
    expect(working?.status).toBe('working')
    expect(working?.workingSince).toBe('2026-09-17T00:00:00.000Z')
    expect(working?.plan).toBeNull()

    const planned: ChatMessage = {
      ...work('planned', 'turn-a', 20),
      metadata: {
        codex: {
          threadId: 'thread-1',
          turnId: 'turn-a',
          usage: null,
          items: [{ id: 'plan-1', type: 'plan', text: '1. Do it' }],
        },
        codexTimeline: { provenance: 'realtime-delegated', turnId: 'turn-a', localOrder: 20 },
      },
    }
    const settled = mapRealtimeTurnActivities({
      turns, messages: [planned], sessionStatus: 'idle', needsDecision: false,
    }).get('voice-user')
    expect(settled?.status).toBe('completed')
    expect(settled?.workingSince).toBeNull()
    expect(settled?.isTail).toBe(true)
    expect(settled?.plan).toEqual({ text: '1. Do it', approval: null })
  })
})
