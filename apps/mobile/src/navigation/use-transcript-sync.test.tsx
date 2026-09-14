import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { WebView } from 'react-native-webview'
import type { HostInbound } from '@superone/chat-view'
import type { ChatRuntime } from '../runtime'
import { useTranscriptSync } from './use-transcript-sync'

test('wires document receipts to the next paint and clears queued work on session exit', async () => {
  jest.useFakeTimers()
  const envelopes: HostInbound[] = []
  const web = { current: { injectJavaScript: jest.fn((script: string) => {
    // Exercise the real native injection wrapper against a fake WebView boundary.
    new Function('globalThis', script)({ __applyHost: (message: HostInbound) => envelopes.push(message) })
  }) } } as unknown as { current: WebView | null }
  const document = web.current
  const runtime = { session: { messages: [], realtimeSegments: [] } } as unknown as ChatRuntime
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
