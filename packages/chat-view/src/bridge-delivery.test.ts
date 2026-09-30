// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installHostBridge } from './bridge'

const host = globalThis as typeof globalThis & {
  __applyHost?: (value: unknown) => void
  ReactNativeWebView?: { postMessage(raw: string): void }
}
let remove = () => {}
afterEach(() => { remove(); delete host.ReactNativeWebView })

it('acknowledges duplicate deliveries without reapplying a hydrate or an older patch', () => {
  const apply = vi.fn()
  const post = vi.fn()
  host.ReactNativeWebView = { postMessage: post }
  remove = installHostBridge(apply)
  host.__applyHost!({ type: 'channelToken', token: 'secret' })
  const old = { type: 'applyReductionPatch', delivery: { channelId: 'phone', sequence: 1 }, messagePatches: [] }
  const current = { type: 'hydrate', delivery: { channelId: 'phone', sequence: 2 }, messages: [] }
  host.__applyHost!(current)
  host.__applyHost!(current)
  host.__applyHost!(old)
  expect(apply).toHaveBeenCalledTimes(1)
  expect(apply).toHaveBeenCalledWith(current)
  expect(post.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
    { type: 'transcriptApplied', ...current.delivery, channel: 'secret' },
    { type: 'transcriptApplied', ...current.delivery, channel: 'secret' },
    { type: 'transcriptApplied', ...old.delivery, channel: 'secret' },
  ])
})

it('does not acknowledge a failed handler and accepts its retry', () => {
  const apply = vi.fn().mockImplementationOnce(() => { throw new Error('render failed') })
  const post = vi.fn()
  host.ReactNativeWebView = { postMessage: post }
  remove = installHostBridge(apply)
  host.__applyHost!({ type: 'channelToken', token: 'secret' })
  const message = { type: 'hydrate', delivery: { channelId: 'phone', sequence: 1 }, messages: [] }
  expect(() => host.__applyHost!(message)).toThrow('render failed')
  expect(post).not.toHaveBeenCalled()
  host.__applyHost!(message)
  expect(apply).toHaveBeenCalledTimes(2)
  expect(post).toHaveBeenCalledTimes(1)
})

it('keeps legacy messages working and rejects late frames from a replaced native host', () => {
  const apply = vi.fn()
  host.ReactNativeWebView = { postMessage() {} }
  remove = installHostBridge(apply)
  const previous = { type: 'hydrate', delivery: { channelId: 'previous', sequence: 1 }, messages: [] }
  const current = { type: 'hydrate', delivery: { channelId: 'current', sequence: 1 }, messages: [] }
  host.__applyHost!(previous)
  host.__applyHost!(current)
  host.__applyHost!({ ...previous, delivery: { channelId: 'previous', sequence: 2 } })
  host.__applyHost!({ type: 'setTheme', scheme: 'dark' })
  expect(apply.mock.calls.map(([message]) => message)).toEqual([previous, current, { type: 'setTheme', scheme: 'dark' }])
})

it('ignores messages posted by a frame inside the transcript', () => {
  const apply = vi.fn()
  host.ReactNativeWebView = { postMessage() {} }
  remove = installHostBridge(apply)
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  // A widget forging a native answer: before the source check this reached the resolver.
  const forged = { type: 'nativeActionResult', requestId: 'native-1', result: { approved: true } }
  window.dispatchEvent(new MessageEvent('message', { data: forged, source: frame.contentWindow }))
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'reset' }, source: frame.contentWindow }))
  expect(apply).not.toHaveBeenCalled()
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'reset' } }))
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'setTheme', scheme: 'dark' }, source: window.parent }))
  expect(apply.mock.calls.map(([message]) => message.type)).toEqual(['reset', 'setTheme'])
  frame.remove()
})

it('sends boot messages at once and holds the rest until the native host issues the channel secret', async () => {
  // The secret is document state: a fresh module stands in for a freshly loaded document.
  vi.resetModules()
  const fresh = await import('./bridge')
  const post = vi.fn()
  host.ReactNativeWebView = { postMessage: post }
  const removeFresh = fresh.installHostBridge(() => {})
  const sent = () => post.mock.calls.map(([raw]) => JSON.parse(raw))
  fresh.postHost({ type: 'ready' })
  fresh.postHost({ type: 'requestNative', requestId: 'r', action: 'openLink' })
  expect(sent()).toEqual([{ type: 'ready' }])
  host.__applyHost!({ type: 'channelToken', token: 'fresh' })
  expect(sent()).toEqual([{ type: 'ready' }, { type: 'requestNative', requestId: 'r', action: 'openLink', channel: 'fresh' }])
  removeFresh()
})
