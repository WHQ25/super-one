import { expect, jest, test } from '@jest/globals'
import { Keyboard } from 'react-native'
import { act, renderHook } from '@testing-library/react-native'
import { useMcpAppFullscreen } from './use-mcp-app-fullscreen'

test('each entry starts with the composer away, and a send hands the screen back to the View', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss')
  const { result } = await renderHook(() => useMcpAppFullscreen(false))
  await act(() => result.current.show({ title: 'Maps' }))
  expect(result.current.view).toEqual({ title: 'Maps' })
  expect(result.current.composerOpen).toBe(false)

  await act(() => result.current.toggleComposer())
  expect(result.current.composerOpen).toBe(true)
  dismiss.mockClear()
  await act(() => result.current.closeComposer())
  expect(result.current.composerOpen).toBe(false)
  expect(dismiss).toHaveBeenCalled()

  await act(() => result.current.toggleComposer())
  await act(() => result.current.show(null))
  await act(() => result.current.show({ title: 'Maps' }))
  expect(result.current.composerOpen).toBe(false)
  dismiss.mockRestore()
})

test('a turn that ends while the composer is away marks the toggle until it is opened', async () => {
  const { result, rerender } = await renderHook(({ streaming }: { streaming: boolean }) => useMcpAppFullscreen(streaming), { initialProps: { streaming: false } })
  await act(() => result.current.show({ title: 'Maps' }))
  await rerender({ streaming: true })
  await rerender({ streaming: false })
  expect(result.current.unread).toBe(true)
  await act(() => result.current.toggleComposer())
  expect(result.current.unread).toBe(false)

  // Read in the open composer's own turn: nothing to mark.
  await rerender({ streaming: true })
  await rerender({ streaming: false })
  expect(result.current.unread).toBe(false)
})
