import { beforeEach, describe, expect, it } from 'vitest'
import { useCodexRealtimeViewStore } from './codex-realtime-view'

describe('codex realtime view store', () => {
  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
  })

  it('keeps the selected view isolated by Codex session', () => {
    useCodexRealtimeViewStore.getState().setView('session-a', 'realtime')

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.view).toBe('realtime')
    expect(useCodexRealtimeViewStore.getState().sessions['session-b']).toBeUndefined()
  })

  it('updates a partial transcript in place and commits the final segment', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'realtime-a')
    store.appendTranscriptDelta('session-a', 'assistant', 'hello ')
    store.appendTranscriptDelta('session-a', 'assistant', 'world')

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.liveText).toEqual({
      role: 'assistant',
      text: 'hello world',
    })

    store.finalizeTranscript('session-a', 'assistant', 'Hello world.')

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']).toMatchObject({
      liveText: null,
      segments: [{
        realtimeSessionId: 'realtime-a',
        role: 'assistant',
        text: 'Hello world.',
      }],
    })
  })

  it('keeps an unpublished live segment when a timeline refresh races with the call', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'realtime-a')
    store.finalizeTranscript('session-a', 'user', 'Live request')
    store.setTimeline('session-a', {
      activeRealtimeSessionId: 'realtime-a',
      hasTimeline: true,
      threadMessages: [],
      segments: [{
        id: 'persisted-1',
        realtimeSessionId: 'realtime-old',
        role: 'assistant',
        text: 'Earlier response',
      }],
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.segments.map((segment) => segment.text))
      .toEqual(['Earlier response', 'Live request'])
  })
})
