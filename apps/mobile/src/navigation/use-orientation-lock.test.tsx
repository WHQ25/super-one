import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { Dimensions } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useOrientationLock } from './use-orientation-lock'

jest.mock('expo-screen-orientation', () => ({
  unlockAsync: jest.fn(async () => {}),
  lockAsync: jest.fn(async () => {}),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}))

test('sends each orientation decision once, including after a remount', async () => {
  const screen = { width: 673, height: 841, scale: 3, fontScale: 1 }
  let onChange: (() => void) | null = null
  jest.spyOn(Dimensions, 'get').mockImplementation(() => screen)
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation((_type, listener) => {
    onChange = listener as () => void
    return { remove: () => { if (onChange === listener) onChange = null } }
  })

  const first = await renderHook(() => useOrientationLock())
  expect(ScreenOrientation.unlockAsync).toHaveBeenCalledTimes(1)
  expect(ScreenOrientation.lockAsync).not.toHaveBeenCalled()

  await first.unmount()
  await renderHook(() => useOrientationLock())
  expect(ScreenOrientation.unlockAsync).toHaveBeenCalledTimes(1)

  screen.width = 390
  screen.height = 844
  await act(() => { onChange?.() })
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(1)

  await act(() => { onChange?.() })
  expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(1)
  expect(ScreenOrientation.unlockAsync).toHaveBeenCalledTimes(1)
})

test('unlocks when the hinge opens while the window is still the cover', async () => {
  const screen = { width: 466, height: 678, scale: 3, fontScale: 1 }
  jest.spyOn(Dimensions, 'get').mockImplementation(() => screen)
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation(() => ({ remove() {} }))
  const unlocks = jest.mocked(ScreenOrientation.unlockAsync).mock.calls.length

  const hook = await renderHook(
    (hinge: 'closed' | 'partial' | 'flat') => useOrientationLock({ hinge }),
    { initialProps: 'closed' as const },
  )
  expect(jest.mocked(ScreenOrientation.unlockAsync).mock.calls.length).toBe(unlocks)

  await hook.rerender('partial')
  expect(jest.mocked(ScreenOrientation.unlockAsync).mock.calls.length).toBe(unlocks + 1)

  await hook.rerender('flat')
  expect(jest.mocked(ScreenOrientation.unlockAsync).mock.calls.length).toBe(unlocks + 1)
})
