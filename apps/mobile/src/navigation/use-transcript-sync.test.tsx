import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { WebView } from 'react-native-webview'
import type { HostInbound } from '@superone/chat-view'
import type { ChatRuntime } from '../runtime'
import { useTranscriptSync } from './use-transcript-sync'
import { createDefaultChatCoreSession, applyEventToSession } from '@superone/chat-core'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { MobileVoiceState } from '../voice/voice-service'

test('updates empty voice hints on media state alone and separates the empty backing thread', async () => {
  const envelopes: HostInbound[] = []
  const web = { current: { injectJavaScript: (script: string) => {
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => envelopes.push(message) })
  } } } as unknown as { current: WebView | null }
  const target = { sessionId: 'voice-task', projectPath: '/repo' }
  const runtime = { ...target, session: createDefaultChatCoreSession() } as unknown as ChatRuntime
  const state: MobileVoiceState = { phase: 'starting', target, inputMuted: false, outputMuted: false, error: null }
  const { result, rerender, unmount } = await renderHook((voice: MobileVoiceState) => useTranscriptSync(web, voice), { initialProps: state })
  const ack = async () => {
    const latest = envelopes.at(-1)!
    if ('delivery' in latest && latest.delivery) await act(async () => { result.current.receive({ type: 'transcriptApplied', ...latest.delivery! }) })
  }
  try {
    await act(async () => { result.current.publish(runtime, {}, true) }); await ack()
    expect(envelopes.at(-1)).toMatchObject({ emptyState: 'voice-starting', conversationView: 'realtime' })
    await rerender({ ...state, phase: 'active' }); await ack()
    expect(envelopes.at(-1)).toMatchObject({ emptyState: 'voice-ready' })
    await act(async () => { result.current.setView('thread') }); await ack()
    expect(envelopes.at(-1)).toMatchObject({ emptyState: 'codex', conversationView: 'thread' })
    await act(async () => { result.current.setView('realtime') }); await ack()
    await rerender({ ...state, phase: 'stopping' }); await ack()
    expect(envelopes.at(-1)).toMatchObject({ emptyState: 'voice-stopping' })
    runtime.session.realtimeHasTimeline = true
    await rerender({ ...state, phase: 'idle', target: null }); await ack()
    expect(envelopes.at(-1)).toMatchObject({ emptyState: 'voice-empty' })
  } finally { await unmount() }
})

test('wires document receipts to the next paint and clears queued work on session exit', async () => {
  jest.useFakeTimers()
  const envelopes: HostInbound[] = []
  const web = { current: { injectJavaScript: jest.fn((script: string) => {
    // Exercise the real native injection wrapper against a fake WebView boundary.
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => envelopes.push(message) })
  }) } } as unknown as { current: WebView | null }
  const document = web.current
  const runtime = { session: createDefaultChatCoreSession() } as unknown as ChatRuntime
  const { result, unmount } = await renderHook(() => useTranscriptSync(web))
  try {
    await act(async () => {
      result.current.publish(runtime, { sessionStatus: 'streaming' })
      result.current.publish(runtime, { sessionStatus: 'idle' })
    })
    expect(envelopes).toHaveLength(1)
    const first = envelopes[0]
    if (!('delivery' in first) || !first.delivery) throw new Error('Missing receipt')
    await act(async () => {
      expect(result.current.receive({ type: 'transcriptApplied', ...first.delivery! })).toBe(true)
    })
    expect(envelopes.at(-1)).toMatchObject({ type: 'applyReductionPatch', sessionStatus: 'idle' })
    await act(async () => { result.current.reset() })
    expect(envelopes.at(-1)).toMatchObject({ type: 'hydrate', messages: [], pendingPermission: null })
    expect(result.current.receive({ type: 'ready' })).toBe(false)
    web.current = null
    await act(async () => { jest.advanceTimersByTime(1000) })
    jest.runAllTicks()
    expect(jest.getTimerCount()).toBe(0)
    web.current = document
    await act(async () => { result.current.publish(runtime, { sessionStatus: 'idle' }) })
    expect(envelopes.at(-1)).toMatchObject({ type: 'hydrate', messages: [] })
  } finally { await unmount(); jest.useRealTimers() }
})

test('delivers live user and agent captions as changed rows before the utterances complete', async () => {
  const envelopes: HostInbound[] = []
  const web = { current: { injectJavaScript: jest.fn((script: string) => {
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => envelopes.push(message) })
  }) } } as unknown as { current: WebView | null }
  const runtime = { session: createDefaultChatCoreSession() } as unknown as ChatRuntime
  const { result, unmount } = await renderHook(() => useTranscriptSync(web))
  const paint = async (event?: AgentEvent) => {
    await act(async () => {
      if (event) runtime.session = { ...runtime.session, ...applyEventToSession(runtime.session, event) }
      result.current.publish(runtime, { sessionStatus: 'idle' })
    })
    const last = envelopes.at(-1)!
    if ('delivery' in last && last.delivery) await act(async () => {
      result.current.receive({ type: 'transcriptApplied', ...last.delivery! })
    })
    return last
  }
  try {
    await paint({ type: 'realtime_started', realtimeSessionId: 'rt', version: '1' })
    await paint({ type: 'realtime_transcript_item', phase: 'started', itemId: 'user', role: 'user', text: '', startedAtMs: 1000 })
    const user = await paint({ type: 'realtime_transcript_item', phase: 'delta', itemId: 'user', text: 'Inspect the logs' })
    expect(user).toMatchObject({ type: 'applyReductionPatch', messagePatches: [{ id: 'codex-realtime-user', role: 'user', status: 'streaming', content: [{ type: 'text', text: 'Inspect the logs' }] }] })
    await paint({ type: 'realtime_transcript_item', phase: 'completed', itemId: 'user', role: 'user', text: 'Inspect the logs', realtimeSessionId: 'rt', startedAtMs: 1000 })
    await paint({ type: 'realtime_transcript_item', phase: 'started', itemId: 'agent', role: 'assistant', text: '', startedAtMs: 2000 })
    const agent = await paint({ type: 'realtime_transcript_item', phase: 'delta', itemId: 'agent', text: 'Checking ' })
    expect(agent).toMatchObject({ type: 'applyReductionPatch', messagePatches: [{ id: 'codex-realtime-agent', role: 'assistant', status: 'streaming', content: [{ type: 'text', text: 'Checking' }] }] })
    const more = await paint({ type: 'realtime_transcript_item', phase: 'delta', itemId: 'agent', text: 'now' })
    expect(more).toMatchObject({ messagePatches: [{ id: 'codex-realtime-agent', content: [{ type: 'text', text: 'Checking now' }] }] })
    const done = await paint({ type: 'realtime_transcript_item', phase: 'completed', itemId: 'agent', role: 'assistant', text: 'Checking now.', realtimeSessionId: 'rt', startedAtMs: 2000 })
    expect(done).toMatchObject({ messagePatches: [{ id: 'codex-realtime-agent', status: 'complete', content: [{ type: 'text', text: 'Checking now.' }] }] })
    expect(runtime.session.messages).toEqual([])
  } finally { await unmount() }
})

test('separates histories, carries restored work at the live edge and opens its source', async () => {
  const envelopes: HostInbound[] = []
  const web = { current: { injectJavaScript: jest.fn((script: string) => {
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => envelopes.push(message) })
  }) } } as unknown as { current: WebView | null }
  const session = createDefaultChatCoreSession()
  session.status = 'streaming'
  session.realtimeSegments = [
    { id: 'speech', role: 'user', text: 'Review the login flow', realtimeSessionId: 'rt', localOrder: 10 },
    { id: 'reply', role: 'assistant', text: 'Checking now', realtimeSessionId: 'rt', localOrder: 11 },
    { id: 'interrupt', role: 'user', text: 'How is it going?', realtimeSessionId: 'rt', localOrder: 20 },
  ]
  session.realtimeThreadMessages = [{ id: 'work', role: 'assistant', status: 'streaming', providerId: 'codex',
    content: [{ type: 'text', text: 'Inspecting authentication code' }], createdAt: '2026-10-10T00:00:00Z',
    metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 'work-turn', localOrder: 12 } } }]
  const runtime = { session, sessionId: 'voice-task' } as unknown as ChatRuntime
  const { result, unmount } = await renderHook(() => useTranscriptSync(web))
  const receiveLast = async () => {
    const message = envelopes.at(-1)!
    if ('delivery' in message && message.delivery) await act(async () => {
      result.current.receive({ type: 'transcriptApplied', ...message.delivery! })
    })
  }
  try {
    await act(async () => { result.current.publish(runtime, { sessionStatus: 'streaming', hasMoreHistory: true, historyNavigation: true }) })
    expect(envelopes.at(-1)).toMatchObject({ conversationView: 'realtime', hasMoreHistory: false, historyNavigation: false,
      messages: [{ id: 'codex-realtime-speech' }, { id: 'codex-realtime-reply' }, { id: 'codex-realtime-interrupt' }],
      realtimeActivities: [{ turnId: 'speech', afterMessageId: null, activity: { status: 'working', messageIds: ['work'] } }] })
    await receiveLast()
    await act(async () => { result.current.setView('thread') })
    expect(result.current.view).toBe('thread')
    expect(envelopes.at(-1)).toMatchObject({ type: 'hydrate', conversationView: 'thread', messages: [{ id: 'work' }],
      realtimeActivities: [], hasMoreHistory: true, historyNavigation: true })
    await receiveLast()
    await act(async () => { result.current.setView('realtime') })
    await receiveLast()
    await act(async () => {
      result.current.receive({ type: 'requestNative', requestId: 'open', action: 'openRealtimeThread', payload: { messageId: 'work' } })
    })
    const hydrate = envelopes.findLast(message => message.type === 'hydrate')!
    expect(hydrate).toMatchObject({ conversationView: 'thread', messages: [{ id: 'work' }] })
    if ('delivery' in hydrate && hydrate.delivery) await act(async () => {
      result.current.receive({ type: 'transcriptApplied', ...hydrate.delivery! })
    })
    expect(envelopes.at(-1)).toEqual({ type: 'scrollToTurn', turnId: 'work', behavior: 'auto' })
    expect(session.messages).toEqual([])
    await act(async () => {
      result.current.receive({ type: 'requestNative', requestId: 'bad', action: 'openRealtimeThread', payload: { messageId: 'other-session' } })
    })
    expect(envelopes.at(-1)).toMatchObject({ type: 'nativeActionResult', requestId: 'bad', error: expect.any(String) })
  } finally { await unmount() }
})
