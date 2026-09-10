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

test('pads Android by the live keyboard height and clears it on hide without remounting the scene', async () => {
  Platform.OS = 'android'
  const mounted = jest.fn()
  function Scene() {
    useEffect(() => { mounted() }, [])
    return <Text>Composer</Text>
  }
  const screen = await renderWithTheme(<MobileKeyboardFrame><Scene /></MobileKeyboardFrame>)
  const frame = () => screen.getByText('Composer').parent!
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1, paddingBottom: 0 })
  await act(async () => { DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(500, 350)) })
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1, paddingBottom: 350 })
  await act(async () => { DeviceEventEmitter.emit('keyboardDidHide', keyboardEvent(850, 0)) })
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1, paddingBottom: 0 })
  expect(mounted).toHaveBeenCalledTimes(1)
})

test('Android frame keeps flex layout through a rotation after a keyboard cycle', async () => {
  Platform.OS = 'android'
  const screen = await renderWithTheme(<MobileKeyboardFrame><Text>Composer</Text></MobileKeyboardFrame>)
  const frame = () => screen.getByText('Composer').parent!
  const layout = async (height: number) => {
    await fireEvent(frame(), 'layout', { nativeEvent: { layout: { x: 0, y: 45, width: 384, height } }, persist() {} })
  }
  // Portrait: first frame, keyboard up, keyboard down.
  await layout(792)
  await act(async () => { DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(536, 301)) })
  await layout(491)
  await act(async () => { DeviceEventEmitter.emit('keyboardDidHide', keyboardEvent(837, 0)) })
  await layout(792)
  // Rotate to landscape with the keyboard down: the frame must stay flex-sized,
  // never `portraitFrame - portraitKeyboard` (491) with `flex: 0`.
  await layout(339)
  expect(StyleSheet.flatten(frame().props.style)).toEqual({ flex: 1, paddingBottom: 0 })
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
