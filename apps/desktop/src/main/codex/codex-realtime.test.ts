import { describe, expect, it, vi } from 'vitest'
import {
  buildCodexRealtimeStartParams,
  listCodexRealtimeTimelinePages,
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
    expect(params).not.toHaveProperty('prompt')
    expect(params).not.toHaveProperty('initialItems')
    expect(params).not.toHaveProperty('realtimeStartInstructions')
    expect(params).not.toHaveProperty('realtimeEndInstructions')
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

  it('maps the item transcript stream so concurrent speakers keep separate buffers', () => {
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/item/started',
      params: {
        threadId: 't1',
        item: { id: 'item-1', realtimeSessionId: 'rt-1', type: 'transcriptSegment', role: 'assistant', text: '' },
      },
    })).toEqual({
      type: 'realtime_transcript_item',
      phase: 'started',
      itemId: 'item-1',
      realtimeSessionId: 'rt-1',
      role: 'assistant',
      text: '',
    })
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/item/transcript/delta',
      params: { threadId: 't1', itemId: 'item-1', delta: 'On ' },
    })).toEqual({ type: 'realtime_transcript_item', phase: 'delta', itemId: 'item-1', text: 'On ' })
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/item/completed',
      params: {
        threadId: 't1',
        item: { id: 'item-1', realtimeSessionId: 'rt-1', type: 'transcriptSegment', role: 'assistant', text: 'On it.' },
      },
    })).toEqual({
      type: 'realtime_transcript_item',
      phase: 'completed',
      itemId: 'item-1',
      realtimeSessionId: 'rt-1',
      role: 'assistant',
      text: 'On it.',
    })
  })

  it('ignores realtime items that are not transcript segments', () => {
    expect(mapCodexRealtimeNotification({
      method: 'thread/realtime/item/completed',
      params: {
        threadId: 't1',
        item: { id: 'item-2', realtimeSessionId: 'rt-1', type: 'realtimeSessionStarted' },
      },
    })).toBeNull()
  })

  it('extracts durable transcript segments from the mixed thread timeline', () => {
    expect(mapCodexRealtimeTimeline({
      data: [
        {
          type: 'realtime',
          position: 3,
          item: {
            id: 'rt-item-2',
            realtimeSessionId: 'rt-1',
            type: 'transcriptSegment',
            role: 'assistant',
            text: 'hi',
          },
        },
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
        { type: 'turnStarted', position: 1, turnId: 'turn-1' },
      ],
      activeRealtimeSessionAtPageStart: 'rt-1',
    })).toEqual({
      segments: [
        {
          id: 'rt-item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello',
          position: 2, provenance: 'realtime-user',
        },
        {
          id: 'rt-item-2', realtimeSessionId: 'rt-1', role: 'assistant', text: 'hi',
          position: 3, provenance: 'realtime-assistant',
        },
      ],
      threadMessages: [
        {
          id: 'codex-realtime-rt-item-1',
          role: 'user',
          status: 'complete',
          content: [{ type: 'text', text: 'hello' }],
          createdAt: '',
          providerId: 'codex',
          metadata: {
            codexTimeline: {
              provenance: 'realtime-user',
              position: 2,
              realtimeSessionId: 'rt-1',
              sourceItemId: 'rt-item-1',
            },
          },
        },
        {
          id: 'codex-realtime-rt-item-2',
          role: 'assistant',
          status: 'complete',
          content: [{ type: 'text', text: 'hi' }],
          createdAt: '',
          providerId: 'codex',
          metadata: {
            codexTimeline: {
              provenance: 'realtime-assistant',
              position: 3,
              realtimeSessionId: 'rt-1',
              sourceItemId: 'rt-item-2',
            },
          },
        },
      ],
      activeRealtimeSessionId: 'rt-1',
      hasTimeline: true,
    })
  })

  it('loads every timeline page using Codex opaque cursors', async () => {
    const cursor = { threadId: 'thread-1', position: 100, kind: 2, id: 'cursor-1' }
    const request = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          type: 'realtime',
          position: 2,
          item: { id: 'newer', realtimeSessionId: 'rt-1', type: 'transcriptSegment', role: 'assistant', text: 'newer' },
        }],
        nextCursor: cursor,
        activeRealtimeSessionAtPageStart: 'rt-1',
      })
      .mockResolvedValueOnce({
        data: [{
          type: 'realtime',
          position: 1,
          item: { id: 'older', realtimeSessionId: 'rt-1', type: 'transcriptSegment', role: 'user', text: 'older' },
        }],
        nextCursor: null,
      })

    const result = await listCodexRealtimeTimelinePages(request, 'thread-1')

    expect(request).toHaveBeenNthCalledWith(1, 'thread/timeline/list', { threadId: 'thread-1', limit: 200 })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/timeline/list', { threadId: 'thread-1', limit: 200, cursor })
    expect(result.segments.map((segment) => segment.id)).toEqual(['older', 'newer'])
    expect(result.activeRealtimeSessionId).toBe('rt-1')
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
      metadata: {
        codex: { threadId: 'thread-1', turnId: 'turn-1' },
        codexTimeline: { provenance: 'codex', position: 1, turnId: 'turn-1' },
      },
    })
  })

  it('interleaves voice transcript with normal turns and keeps the realtime delegation input', () => {
    const result = mapCodexRealtimeTimeline({
      data: [
        {
          type: 'realtime',
          position: 1,
          item: {
            type: 'transcriptSegment',
            id: 'voice-user-1',
            realtimeSessionId: 'rt-1',
            role: 'user',
            text: 'Inspect the project',
          },
        },
        { type: 'turnStarted', position: 2, turnId: 'turn-1' },
        {
          type: 'item',
          position: 3,
          turnId: 'turn-1',
          item: {
            type: 'userMessage',
            id: 'delegation-1',
            content: [{
              type: 'text',
              text: '<realtime_delegation>\n<input>Inspect the project</input>\n</realtime_delegation>',
            }],
          },
        },
        {
          type: 'item',
          position: 4,
          turnId: 'turn-1',
          item: { type: 'agentMessage', id: 'agent-1', text: 'Found the issue', phase: null, delivery: null },
        },
        { type: 'turnCompleted', position: 5, turnId: 'turn-1', status: 'completed' },
      ],
    }, 'thread-1')

    // The delegation prompt is the only record of what the voice agent asked Codex
    // to do; it rides its turn so the backing-thread view can show it verbatim.
    expect(result.threadMessages.map((message) => [message.id, message.role])).toEqual([
      ['codex-realtime-voice-user-1', 'user'],
      ['delegation-1', 'user'],
      ['codex-timeline-turn-1', 'assistant'],
    ])
    expect(result.threadMessages[0]?.content).toEqual([{ type: 'text', text: 'Inspect the project' }])
    expect(result.threadMessages[1]?.content).toEqual([{
      type: 'text',
      text: '<realtime_delegation>\n<input>Inspect the project</input>\n</realtime_delegation>',
    }])
    expect(result.threadMessages[1]?.metadata).toMatchObject({
      codexTimeline: { provenance: 'realtime-delegated', position: 2, turnId: 'turn-1' },
    })
    expect(result.threadMessages[2]?.content).toEqual([{ type: 'text', text: 'Found the issue' }])
    expect(result.threadMessages[2]?.metadata).toMatchObject({
      codexTimeline: {
        provenance: 'realtime-delegated',
        position: 5,
        turnId: 'turn-1',
      },
    })
  })

  it('maps two voice and delegated interactions into one provider-positioned timeline', () => {
    const delegation = (id: string, turnId: string, position: number, text: string) => ({
      type: 'item',
      position,
      turnId,
      item: {
        type: 'userMessage',
        id,
        content: [{ type: 'text', text: `<realtime_delegation><input>${text}</input></realtime_delegation>` }],
      },
    })
    const voice = (
      id: string,
      position: number,
      role: 'user' | 'assistant',
      text: string,
    ) => ({
      type: 'realtime',
      position,
      item: { type: 'transcriptSegment', id, realtimeSessionId: 'rt-1', role, text },
    })

    const result = mapCodexRealtimeTimeline({
      data: [
        voice('user-1', 1, 'user', 'Inspect this problem.'),
        voice('voice-1', 2, 'assistant', "Okay, I'll check it."),
        { type: 'turnStarted', position: 3, turnId: 'turn-1' },
        delegation('delegation-1', 'turn-1', 4, 'Inspect this problem.'),
        { type: 'item', position: 5, turnId: 'turn-1', item: { type: 'agentMessage', id: 'agent-1', text: 'Root cause found.', phase: null, delivery: null } },
        { type: 'turnCompleted', position: 6, turnId: 'turn-1', status: 'completed' },
        voice('user-2', 7, 'user', 'Please fix it.'),
        voice('voice-2', 8, 'assistant', 'Okay.'),
        { type: 'turnStarted', position: 9, turnId: 'turn-2' },
        delegation('delegation-2', 'turn-2', 10, 'Please fix it.'),
        { type: 'item', position: 11, turnId: 'turn-2', item: { type: 'agentMessage', id: 'agent-2', text: 'Fixed and verified.', phase: null, delivery: null } },
        { type: 'turnCompleted', position: 12, turnId: 'turn-2', status: 'completed' },
      ],
    }, 'thread-1')

    expect(result.threadMessages.map((message) => message.content[0])).toEqual([
      { type: 'text', text: 'Inspect this problem.' },
      { type: 'text', text: "Okay, I'll check it." },
      { type: 'text', text: '<realtime_delegation><input>Inspect this problem.</input></realtime_delegation>' },
      { type: 'text', text: 'Root cause found.' },
      { type: 'text', text: 'Please fix it.' },
      { type: 'text', text: 'Okay.' },
      { type: 'text', text: '<realtime_delegation><input>Please fix it.</input></realtime_delegation>' },
      { type: 'text', text: 'Fixed and verified.' },
    ])
    expect(result.threadMessages.map((message) => (
      (message.metadata as { codexTimeline?: { provenance?: string } } | undefined)
        ?.codexTimeline?.provenance
    ))).toEqual([
      'realtime-user',
      'realtime-assistant',
      'realtime-delegated',
      'realtime-delegated',
      'realtime-user',
      'realtime-assistant',
      'realtime-delegated',
      'realtime-delegated',
    ])
    expect(result.threadMessages
      .filter((message) => message.role === 'assistant'
        && message.metadata?.codexTimeline?.provenance === 'realtime-delegated')
      .map((message) => message.metadata?.codexTimeline?.position))
      .toEqual([6, 12])
  })
})
