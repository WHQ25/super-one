import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import type { BarcodeScanningResult } from 'expo-camera'
import { AppState } from 'react-native'
import { renderWithTheme } from '../test-render'
import { QR_AUTO_SELECT_MS } from './qr-scanner-state'
import { QrScanner } from './qr-scanner'

type CapturedNativeProps = {
  active: boolean
  enableTorch: boolean
  zoom: number
  onBarcodesScanned: (barcodes: BarcodeScanningResult[]) => void
  onMountError: () => void
}

let latestNativeProps: CapturedNativeProps | null = null

jest.mock('expo-camera', () => {
  const { View } = require('react-native')
  return { CameraView: (props: object) => <View {...props} testID="fallback-camera" /> }
})

jest.mock('./native-qr-scanner', () => {
  const { View } = require('react-native')
  return {
    nativeAndroidQrCameraAvailable: true,
    NativeQrCamera: (props: CapturedNativeProps) => {
      latestNativeProps = props
      return <View testID="native-wechat-camera" />
    },
    pickAndScanQrImage: jest.fn(async () => null),
  }
})

const first: BarcodeScanningResult = {
  type: 'qr',
  data: 'superone://pair?channel=one',
  cornerPoints: [{ x: 20, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 140 }, { x: 20, y: 140 }],
  bounds: { origin: { x: 20, y: 40 }, size: { width: 100, height: 100 } },
}

const second: BarcodeScanningResult = {
  type: 'qr',
  data: 'superone://pair?channel=two',
  cornerPoints: [{ x: 180, y: 240 }, { x: 280, y: 240 }, { x: 280, y: 340 }, { x: 180, y: 340 }],
  bounds: { origin: { x: 180, y: 240 }, size: { width: 100, height: 100 } },
}

beforeEach(() => {
  AppState.currentState = 'active'
  latestNativeProps = null
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('uses the native WeChat QR camera on Android and handles multi-code frames atomically', async () => {
  const onSelect = jest.fn()
  const view = await renderWithTheme(<QrScanner onSelect={onSelect} onCancel={jest.fn()} />, 'dark', 'zh')
  await act(async () => {
    fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 360, height: 640 } } })
  })
  expect(view.getByTestId('native-wechat-camera')).toBeTruthy()
  expect(view.queryByTestId('fallback-camera')).toBeNull()
  expect(latestNativeProps?.zoom).toBe(1)
  expect(latestNativeProps?.enableTorch).toBe(false)

  await act(async () => { fireEvent.press(view.getByLabelText('放大画面')) })
  expect(latestNativeProps?.zoom).toBe(2)

  await act(async () => { fireEvent.press(view.getByLabelText('打开手电筒')) })
  expect(latestNativeProps?.enableTorch).toBe(true)

  await act(async () => {
    latestNativeProps?.onBarcodesScanned([first, second])
  })
  expect(view.getByLabelText('二维码 1')).toBeTruthy()
  expect(view.getByLabelText('二维码 2')).toBeTruthy()

  await act(async () => { fireEvent.press(view.getByLabelText('二维码 1')) })
  expect(onSelect).toHaveBeenCalledWith(first)
})

it('auto-selects a lone code from the native Android camera after the settle window', async () => {
  const onSelect = jest.fn()
  const view = await renderWithTheme(<QrScanner onSelect={onSelect} onCancel={jest.fn()} />, 'dark', 'en')
  await act(async () => {
    fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 360, height: 640 } } })
  })
  await act(async () => {
    latestNativeProps?.onBarcodesScanned([first])
  })
  await act(async () => { jest.advanceTimersByTime(QR_AUTO_SELECT_MS) })
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(first)
})
