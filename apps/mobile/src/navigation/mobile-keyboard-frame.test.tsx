import { afterEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { useEffect } from 'react'
import { DeviceEventEmitter, Platform, StyleSheet, Text } from 'react-native'
import { renderWithTheme } from '../test-render'
import { MobileKeyboardFrame } from './mobile-keyboard-frame'

const originalOS = Platform.OS
afterEach(() => { Platform.OS = originalOS })

const keyboardEvent = (screenY: number, height: number) => ({
  duration: 0, easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY, width: 400, height },
  startCoordinates: { screenX: 0, screenY: 850, width: 400, height: 0 },
})

test('releases stale height after the first Android keyboard cycle without remounting the scene', async () => {
  Platform.OS = 'android'
  const mounted = jest.fn()
  function Scene() {
    useEffect(() => { mounted() }, [])
    return <Text>Composer</Text>
  }
  const screen = await renderWithTheme(<MobileKeyboardFrame><Scene /></MobileKeyboardFrame>)
  const frame = () => screen.getByText('Composer').parent!
  const layout = async (height: number) => {
    await fireEvent(frame(), 'layout', { nativeEvent: { layout: { x: 0, y: 24, width: 400, height } }, persist() {} })
  }
  // The first frame precedes safe-area resolution. Height mode must not restore it.
  await layout(850)
  await layout(800)
  await act(async () => { DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(500, 350)) })
  expect(StyleSheet.flatten(frame().props.style).flex).toBe(0)
  await layout(526)
  await act(async () => { DeviceEventEmitter.emit('keyboardDidHide', keyboardEvent(850, 0)) })
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1 })
  expect(mounted).toHaveBeenCalledTimes(1)
})

test('clears iOS keyboard padding on hide', async () => {
  Platform.OS = 'ios'
  const screen = await renderWithTheme(<MobileKeyboardFrame><Text>Composer</Text></MobileKeyboardFrame>)
  const frame = () => screen.getByText('Composer').parent!
  await fireEvent(frame(), 'layout', { nativeEvent: { layout: { x: 0, y: 24, width: 400, height: 800 } }, persist() {} })
  await act(async () => { DeviceEventEmitter.emit('keyboardWillShow', keyboardEvent(500, 350)) })
  expect(StyleSheet.flatten(frame().props.style).paddingBottom).toBeGreaterThan(0)
  await act(async () => { DeviceEventEmitter.emit('keyboardWillHide', keyboardEvent(850, 0)) })
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1, paddingBottom: 0 })
})
