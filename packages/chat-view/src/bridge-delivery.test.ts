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
  const old = { type: 'applyReductionPatch', delivery: { channelId: 'phone', sequence: 1 }, messagePatches: [] }
  const current = { type: 'hydrate', delivery: { channelId: 'phone', sequence: 2 }, messages: [] }
  host.__applyHost!(current)
  host.__applyHost!(current)
  host.__applyHost!(old)
  expect(apply).toHaveBeenCalledTimes(1)
  expect(apply).toHaveBeenCalledWith(current)
  expect(post.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
    { type: 'transcriptApplied', ...current.delivery },
    { type: 'transcriptApplied', ...current.delivery },
    { type: 'transcriptApplied', ...old.delivery },
  ])
})

it('does not acknowledge a failed handler and accepts its retry', () => {
  const apply = vi.fn().mockImplementationOnce(() => { throw new Error('render failed') })
  const post = vi.fn()
  host.ReactNativeWebView = { postMessage: post }
  remove = installHostBridge(apply)
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
