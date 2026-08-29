/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateCodexRealtimeTimeline, useCodexRealtimeViewStore } from './codex-realtime-view'

describe('codex realtime view store', () => {
  beforeEach(() => {
    useCodexRealtimeViewStore.setState({ sessions: {} })
  })

  it('replaces a live segment with the local snapshot despite a session id mismatch', () => {
    const store = useCodexRealtimeViewStore.getState()
    store.setRealtimeSession('session-a', 'rt-1')
    store.finalizeTranscript('session-a', 'assistant', 'same reply')

    store.setTimeline('session-a', {
      segments: [{
        id: 'local-1',
        realtimeSessionId: 'live',
        role: 'assistant',
        text: 'same reply',
      }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })

    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.segments)
      .toHaveLength(1)
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
    expect(useCodexRealtimeViewStore.getState().sessions['session-a']?.view).toBe('realtime')

    resolveProvider({ segments: [], threadMessages: [], activeRealtimeSessionId: null, hasTimeline: true })
    await hydration
  })
})
