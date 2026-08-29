import { describe, expect, it, vi } from 'vitest'
import {
  buildCodexRealtimeStartParams,
  mapCodexRealtimeVoiceCatalog,
  mapCodexRealtimeNotification,
  mapCodexRealtimeTimeline,
} from './codex-realtime'

describe('Codex realtime protocol mapping', () => {
  it('uses frameless v3 so Codex negotiates quicksilver v2', () => {
    const params = buildCodexRealtimeStartParams('t1', { sdp: 'offer', voice: 'cove' })

    expect(params).toMatchObject({
      threadId: 't1',
      version: 'v3',
      outputModality: 'audio',
      codexResponseHandoffMode: 'bemTags',
      voice: 'cove',
      transport: { type: 'webrtc', sdp: 'offer' },
    })
    expect(params).not.toHaveProperty('model')
  })

  it('lets app-server choose its current default voice when none is configured', () => {
    expect(buildCodexRealtimeStartParams('t1', { sdp: 'offer' })).not.toHaveProperty('voice')
  })

  it('flattens the v1 catalog used by realtime v3', () => {
    expect(mapCodexRealtimeVoiceCatalog({
      voices: {
        v1: ['juniper', 'cove'],
        v2: ['marin'],
        defaultV1: 'cove',
        defaultV2: 'marin',
      },
    })).toEqual({ voices: ['juniper', 'cove'], defaultVoice: 'cove' })
  })

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
      threadMessages: [],
      activeRealtimeSessionId: 'rt-1',
      hasTimeline: true,
    })
  })

  it('reports a realtime timeline even when it has no transcript segments', () => {
    expect(mapCodexRealtimeTimeline({
      data: [{
        type: 'realtime',
        position: 1,
        item: { id: 'started-1', realtimeSessionId: 'rt-1', type: 'realtimeSessionStarted' },
      }],
    })).toEqual({
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })
  })

  it('maps ordinary timeline turns into the backing Codex thread transcript', () => {
    const result = mapCodexRealtimeTimeline({
      data: [
        { type: 'turnStarted', position: 1, turnId: 'turn-1' },
        {
          type: 'item',
          position: 2,
          turnId: 'turn-1',
          item: {
            type: 'userMessage',
            id: 'user-item-1',
            clientId: 'user-1',
            content: [{ type: 'text', text: 'Inspect the project', text_elements: [] }],
          },
        },
        {
          type: 'item',
          position: 3,
          turnId: 'turn-1',
          item: { type: 'agentMessage', id: 'agent-1', text: 'Done', phase: null, delivery: null },
        },
        { type: 'turnCompleted', position: 4, turnId: 'turn-1', status: 'completed' },
      ],
    }, 'thread-1')

    expect(result.threadMessages).toHaveLength(2)
    expect(result.threadMessages[0]).toMatchObject({
      id: 'user-1',
      role: 'user',
      content: [{ type: 'text', text: 'Inspect the project' }],
    })
    expect(result.threadMessages[1]).toMatchObject({
      id: 'codex-timeline-turn-1',
      role: 'assistant',
      status: 'complete',
      content: [{ type: 'text', text: 'Done' }],
      metadata: { codex: { threadId: 'thread-1', turnId: 'turn-1' } },
    })
  })
})
