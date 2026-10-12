import { describe, expect, it } from 'vitest'
import type { ChatMessage, RealtimeTimelineSegment } from './agent-types'
import { projectRealtimeTranscript } from './realtime-transcript-projection'

const segments: RealtimeTimelineSegment[] = [
  { id: 'u1', realtimeSessionId: 'rt', role: 'user', text: 'Inspect auth', localOrder: 1 },
  { id: 'a1', realtimeSessionId: 'rt', role: 'assistant', text: 'Checking', localOrder: 2 },
  { id: 'u2', realtimeSessionId: 'rt', role: 'user', text: 'Any news?', localOrder: 10 },
]
function work(status: ChatMessage['status']): ChatMessage {
  return { id: 'work', providerId: 'codex', role: 'assistant', status, createdAt: '2026-10-10T00:00:00Z',
    content: [{ type: 'text', text: 'Backing task output' }],
    metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 3, turnId: 't1' } } }
}

describe('separate realtime transcript projection', () => {
  it('times the latest delegated assistant turn when mobile retains delegation prompts', () => {
    const earlier = { ...work('complete'), createdAt: '2026-10-10T00:00:00Z' }
    const prompt: ChatMessage = {
      id: 'prompt', providerId: 'codex', role: 'user', status: 'complete', createdAt: '',
      content: [{ type: 'text', text: '<realtime_delegation>Review the plan</realtime_delegation>' }],
      metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 4, turnId: 't2' } },
    }
    const latest: ChatMessage = {
      ...work('streaming'), id: 'latest', createdAt: '2026-10-10T03:13:51Z',
      metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 5, turnId: 't2' } },
    }
    const result = projectRealtimeTranscript({ messages: [earlier, prompt, latest], segments: segments.slice(0, 2),
      liveSegments: [], sessionStatus: 'streaming', needsDecision: false })

    expect(result.activities).toMatchObject([{ activity: { status: 'working', workingSince: latest.createdAt } }])
  })

  it('pins unfinished work after newer speech and attaches settled detail to the originating turn', () => {
    const project = (status: ChatMessage['status']) => projectRealtimeTranscript({ messages: [work(status)], segments,
      liveSegments: [], sessionStatus: status === 'streaming' ? 'streaming' : 'idle', needsDecision: false })
    const running = project('streaming')
    expect(running.messages.map(row => row.id)).toEqual(['codex-realtime-u1', 'codex-realtime-a1', 'codex-realtime-u2'])
    expect(running.activities).toMatchObject([{ afterMessageId: null, activity: { status: 'working', turnIds: ['t1'] } }])
    expect(project('complete').activities).toMatchObject([{ afterMessageId: 'codex-realtime-a1', activity: { status: 'completed' } }])
    expect(project('error').activities).toMatchObject([{ activity: { status: 'failed' } }])
  })
  it('keeps pending decisions on delegated work but does not assign a later typed turn to voice', () => {
    const task = work('complete')
    const project = (messages: ChatMessage[]) => projectRealtimeTranscript({ messages, segments, liveSegments: [],
      sessionStatus: 'streaming', needsDecision: true })
    expect(project([task]).activities[0].activity.status).toBe('needs-decision')
    const typed: ChatMessage = { id: 'typed', role: 'user', status: 'complete', content: [{ type: 'text', text: 'Typed follow-up' }], createdAt: '' }
    const result = project([task, typed])
    expect(result.activities[0].activity.status).toBe('completed')
    expect(result.messages.some(row => row.id === 'typed')).toBe(false)
  })
  it('merges consecutive live agent items with stable identity and completed captions', () => {
    const live: RealtimeTimelineSegment = { id: 'a2', realtimeSessionId: 'rt', role: 'assistant', text: 'Still inspecting', localOrder: 4 }
    const result = projectRealtimeTranscript({ messages: [], segments: segments.slice(0, 2), liveSegments: [live], sessionStatus: 'idle', needsDecision: false })
    expect(result.messages[1]).toMatchObject({ id: 'codex-realtime-a1', status: 'streaming', content: [{ text: 'Checking\n\nStill inspecting' }] })
  })
})
