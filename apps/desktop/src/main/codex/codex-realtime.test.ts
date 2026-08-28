import { describe, expect, it } from 'vitest'
import { mapCodexRealtimeNotification, mapCodexRealtimeTimeline } from './codex-realtime'

describe('Codex realtime protocol mapping', () => {
  it('maps SDP and transcript notifications to harness-neutral events', () => {
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/sdp',
      params: { threadId: 't1', sdp: 'answer' },
    })).toEqual({ type: 'realtime_sdp', sdp: 'answer' })
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 't1', role: 'assistant', text: 'Done' },
    })).toEqual({ type: 'realtime_transcript', role: 'assistant', text: 'Done', final: true })
  })

  it('extracts durable transcript segments from the mixed thread timeline', () => {
    expect(mapCodexRealtimeTimeline({
      data: [
        { type: 'turnStarted', position: 1, turnId: 'turn-1' },
        {
          type: 'realtime',
          position: 2,
          item: {
            id: 'rt-item-1',
            realtimeSessionId: 'rt-1',
            type: 'transcriptSegment',
            role: 'user',
            text: 'hello',
          },
        },
      ],
      activeRealtimeSessionAtPageStart: 'rt-1',
    })).toEqual({
      segments: [{ id: 'rt-item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello' }],
      activeRealtimeSessionId: 'rt-1',
    })
  })
})
