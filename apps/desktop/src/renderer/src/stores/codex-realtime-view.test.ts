/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateCodexRealtimeTimeline, useCodexRealtimeViewStore } from './codex-realtime-view'

function liveTranscript(sessionId: string): { role: string; text: string }[] {
  return (useCodexRealtimeViewStore.getState().sessions[sessionId]?.liveItems ?? [])
    .map((item) => ({ role: item.role, text: item.text }))
}

describe('codex realtime view store', () => {
  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
  })

  it('keeps a loaded timeline on screen while a remount revalidates it', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setTimeline('session-a', {
      activeRealtimeSessionId: null,
      hasTimeline: true,
      threadMessages: [],
      segments: [{ id: 'segment-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Read the file' }],
    })

    // Mounting the realtime view is itself what triggers a refresh, so a loaded
    // timeline must not be flipped back to `loading` — that blanks the transcript.
    store.setTimelineLoading('session-a')

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.loadStatus).toBe('loaded')
  })

  it('streams an interleaved user and assistant transcript into separate buffers', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.startTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'Checking ')
    // The user barges in while the assistant is still speaking.
    store.startTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'user-1', 'wait')
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'the logs')

    expect(liveTranscript('session-a')).toEqual([
      { role: 'assistant', text: 'Checking the logs' },
      { role: 'user', text: 'wait' },
    ])
  })

  it('orders transcripts by when speech started even when transcription finishes late', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.startTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'user-1', 'Read the file')
    store.startTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'On it')
    // Speech recognition for the user turn completes after the assistant already replied.
    store.completeTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'On it.',
    })
    store.completeTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Read the file.',
    })

    expect(liveTranscript('session-a')).toEqual([
      { role: 'user', text: 'Read the file.' },
      { role: 'assistant', text: 'On it.' },
    ])
  })

  it('replaces the streamed deltas with the canonical text on completion', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.startTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: '',
    })
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'hello ')
    store.appendTranscriptItemDelta('session-a', 'assistant-1', 'world')
    store.completeTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Hello world.',
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.liveItems).toEqual([{
      itemId: 'assistant-1',
      realtimeSessionId: 'rt-1',
      role: 'assistant',
      text: 'Hello world.',
      done: true,
    }])
  })

  it('does not let a stale timeline snapshot change event-driven liveness', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.setTimeline('session-a', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.realtimeSessionId).toBe('rt-1')

    store.setRealtimeSession('session-a', null)
    store.setTimeline('session-a', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: 'rt-1',
      hasTimeline: true,
    })
    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.realtimeSessionId).toBeNull()
  })

  it('hydrates realtime liveness before any local lifecycle event arrives', () => {
    useCodexRealtimeViewStore.getState().setTimeline('session-a', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: 'rt-restored',
      hasTimeline: true,
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.realtimeSessionId)
      .toBe('rt-restored')
  })

  it('records an item that completes before the view saw it start', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.completeTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Mid-call mount.',
    })

    expect(liveTranscript('session-a')).toEqual([{ role: 'user', text: 'Mid-call mount.' }])
  })

  it('drops a live item once the timeline snapshot publishes the same one', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.completeTranscriptItem('session-a', {
      itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'same reply',
    })

    store.setTimeline('session-a', {
      segments: [{
        id: 'assistant-1',
        realtimeSessionId: 'rt-1',
        role: 'assistant',
        text: 'same reply',
      }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']).toMatchObject({
      liveItems: [],
      segments: [{ id: 'assistant-1', text: 'same reply' }],
    })
  })

  it('keeps an unpublished live item when a timeline refresh races with the call', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'realtime-a')
    store.completeTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'realtime-a', role: 'user', text: 'Live request',
    })
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

    const session = useCodexRealtimeViewStore.getState().sessions['session-a']
    expect(session?.segments.map((segment) => segment.text)).toEqual(['Earlier response'])
    expect(liveTranscript('session-a')).toEqual([{ role: 'user', text: 'Live request' }])
  })

  it('drops a live item the local snapshot already committed under its own id', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.completeTranscriptItem('session-a', {
      itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Cached request',
    })
    store.setTimeline('session-a', {
      activeRealtimeSessionId: 'rt-1',
      hasTimeline: true,
      threadMessages: [],
      segments: [{
        id: 'local-abc',
        sourceItemId: 'user-1',
        realtimeSessionId: 'rt-1',
        role: 'user',
        text: 'Cached request',
      }],
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.liveItems).toEqual([])
  })

  it('renders the local snapshot before the provider refresh finishes', async () => {
    let resolveProvider!: (timeline: {
      segments: never[]
      threadMessages: never[]
      activeRealtimeSessionId: null
      hasTimeline: boolean
    }) => void
    const provider = new Promise<{
      segments: never[]
      threadMessages: never[]
      activeRealtimeSessionId: null
      hasTimeline: boolean
    }>((resolve) => { resolveProvider = resolve })
    Object.defineProperty(window, 'agent', {
      configurable: true,
      value: {
        loadRealtimeTimeline: vi.fn(async () => ({
          segments: [{ id: 'local-1', realtimeSessionId: 'rt-1', role: 'user', text: 'cached request' }],
          threadMessages: [],
          activeRealtimeSessionId: null,
          hasTimeline: true,
        })),
        getRealtimeTimeline: vi.fn(() => provider),
      },
    })

    const hydration = hydrateCodexRealtimeTimeline('/repo', 'session-a')
    await vi.waitFor(() => {
      expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.segments[0]?.text)
        .toBe('cached request')
    })
    resolveProvider({ segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: true })
    await hydration
  })

  it('keeps restored voice history when the provider refresh fails', async () => {
    Object.defineProperty(window, 'agent', {
      configurable: true,
      value: {
        loadRealtimeTimeline: vi.fn(async () => ({
          segments: [{ id: 'local-1', realtimeSessionId: 'rt-1', role: 'user', text: 'restored request' }],
          threadMessages: [],
          activeRealtimeSessionId: null,
          hasTimeline: true,
        })),
        getRealtimeTimeline: vi.fn(async () => { throw new Error('provider unavailable') }),
      },
    })

    await hydrateCodexRealtimeTimeline('/repo', 'session-a')

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']).toMatchObject({
      loadStatus: 'loaded',
      realtimeSessionId: null,
      hasTimeline: true,
      segments: [{ text: 'restored request' }],
    })
  })
})
