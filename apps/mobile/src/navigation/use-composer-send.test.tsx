import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useComposerSend } from './use-composer-send'
import type { NativeComposerController } from '../ui/native-composer-input'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
function editor(prepareSubmit: () => Promise<void>) {
  return { current: { prepareSubmit } as NativeComposerController }
}

test('rapid taps send once, after native composition is committed', async () => {
  const native = deferred()
  const ref = editor(() => native.promise)
  const send = jest.fn<() => void>()
  const { result } = await renderHook(() => useComposerSend(ref, 'session', send, jest.fn()))
  let first!: Promise<void>
  await act(() => { first = result.current(); void result.current() })
  expect(send).not.toHaveBeenCalled()
  await act(async () => { native.resolve(); await first })
  expect(send).toHaveBeenCalledTimes(1)
})

test('a synchronization error is surfaced, with a later tap able to retry', async () => {
  const prepare = jest.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('Editor unavailable')).mockResolvedValue(undefined)
  const ref = editor(prepare)
  const send = jest.fn<() => void>()
  const onError = jest.fn()
  const { result } = await renderHook(() => useComposerSend(ref, 'session', send, onError))
  await act(() => result.current())
  expect(send).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledWith('Editor unavailable')
  await act(() => result.current())
  expect(send).toHaveBeenCalledTimes(1)
})

test('switching sessions during preparation cancels the send', async () => {
  const native = deferred()
  const ref = editor(() => native.promise)
  const send = jest.fn<() => void>()
  const { result, rerender } = await renderHook<() => Promise<void>, { scope: string }>(({ scope }) => useComposerSend(ref, scope, send, jest.fn()), { initialProps: { scope: 'old' } })
  let pending!: Promise<void>
  await act(() => { pending = result.current() })
  await rerender({ scope: 'new' })
  await act(async () => { native.resolve(); await pending })
  expect(send).not.toHaveBeenCalled()
})

test('the fallback editor sends without native preparation and surfaces transport failures', async () => {
  const onError = jest.fn()
  const send = jest.fn(() => { throw new Error('Disconnected') })
  const { result } = await renderHook(() => useComposerSend({ current: null }, 'session', send, onError))
  await act(() => result.current())
  expect(onError).toHaveBeenCalledWith('Disconnected')
})


test('a controller refresh during native acknowledgement does not swallow the tap', async () => {
  const native = deferred()
  const ref = editor(() => native.promise)
  const send = jest.fn<() => void>()
  const { result, rerender } = await renderHook(() => useComposerSend(ref, 'session', send, jest.fn()))
  let pending!: Promise<void>
  await act(() => { pending = result.current() })
  // useImperativeHandle refreshes the controller when the acknowledged draft
  // triggers a render. It is still the same editor and the same conversation.
  ref.current = { prepareSubmit: () => native.promise } as NativeComposerController
  await rerender({})
  await act(async () => { native.resolve(); await pending })
  expect(send).toHaveBeenCalledTimes(1)
})
