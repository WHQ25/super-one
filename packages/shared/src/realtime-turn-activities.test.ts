import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { buildRealtimeConversationTurns } from './realtime-transcript'
import { mapRealtimeTurnActivities } from './realtime-turn-activities'

const turns = buildRealtimeConversationTurns([
  { id: 'voice', realtimeSessionId: 'rt', role: 'user', text: 'Review the plan', localOrder: 1 },
])

function work(id: string, turnId: string | undefined, createdAt: string, status: ChatMessage['status']): ChatMessage {
  return {
    id, role: 'assistant', providerId: 'codex', status, createdAt, content: [],
    metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 2, turnId } },
  }
}

const earlier = work('earlier', 'old-turn', '2026-10-13T00:00:00Z', 'complete')
const current = work('current', 'latest-turn', '2026-10-13T03:13:51Z', 'streaming')

describe('latest delegated turn timer', () => {
  it.each(['streaming', 'background'] as const)('starts from the latest backing turn while the session is %s', (sessionStatus) => {
    const latest = sessionStatus === 'background' ? { ...current, status: 'complete' as const } : current
    const activity = mapRealtimeTurnActivities({ turns, messages: [earlier, latest], sessionStatus, needsDecision: false }).get('voice')

    expect(activity).toMatchObject({ status: 'working', workingSince: current.createdAt, turnIds: ['old-turn', 'latest-turn'] })
  })

  it('keeps the start time when a steer splits the latest turn into more assistant rows', () => {
    const first: ChatMessage = {
      ...current, status: 'complete',
      metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 2 },
        codex: { threadId: 'thread', turnId: 'latest-turn', usage: null, items: [] } },
    }
    const steered = work('steered', 'latest-turn', '2026-10-13T03:13:55Z', 'streaming')
    const activity = mapRealtimeTurnActivities({ turns, messages: [earlier, first, steered], sessionStatus: 'streaming', needsDecision: false }).get('voice')

    expect(activity?.workingSince).toBe(current.createdAt)
  })

  it('uses the latest row when the provider has not supplied a turn id', () => {
    const latest = work('current', undefined, current.createdAt, 'streaming')
    const activity = mapRealtimeTurnActivities({ turns, messages: [earlier, latest], sessionStatus: 'streaming', needsDecision: false }).get('voice')

    expect(activity?.workingSince).toBe(current.createdAt)
  })

  it.each(['', 'invalid'])('does not inherit an older timestamp when the latest start is %j', (createdAt) => {
    const activity = mapRealtimeTurnActivities({ turns, messages: [earlier, { ...current, createdAt }], sessionStatus: 'streaming', needsDecision: false }).get('voice')

    expect(activity?.workingSince).toBeNull()
  })
})
