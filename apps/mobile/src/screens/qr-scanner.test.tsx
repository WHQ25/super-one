import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import { renderWithTheme } from '../test-render'
import { QrScanner } from './qr-scanner'

jest.mock('expo-camera', () => {
  const { View } = require('react-native')
  return { CameraView: (props: object) => <View {...props} testID="scanner-camera" /> }
})

const detection = {
  type: 'qr', data: 'https://example.com/any-qr', cornerPoints: [],
  bounds: { origin: { x: 20, y: 100 }, size: { width: 100, height: 100 } },
}

beforeEach(() => { AppState.currentState = 'active' })
afterEach(() => { jest.restoreAllMocks() })

async function setup(locale: 'en' | 'zh' = 'en', theme: 'light' | 'dark' = 'dark') {
  const onSelect = jest.fn()
  const onCancel = jest.fn()
  const view = await renderWithTheme(<QrScanner onSelect={onSelect} onCancel={onCancel} />, theme, locale)
  await act(async () => { fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 360, height: 640 } } }) })
  return { view, onSelect, onCancel }
}

it('keeps a single QR awaiting a tap, and submits only once', async () => {
  const { view, onSelect } = await setup()
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', detection) })
  expect(onSelect).not.toHaveBeenCalled()
  const target = view.getByLabelText('QR Code 1')
  await act(async () => { fireEvent.press(target) })
  await act(async () => { fireEvent.press(target) })
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(detection)
})

it('does not submit a stale target even before the expiry timer paints', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
  const { view, onSelect } = await setup()
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', detection) })
  now.mockReturnValue(2000)
  await act(async () => { fireEvent.press(view.getByLabelText('QR Code 1')) })
  expect(onSelect).not.toHaveBeenCalled()
})

it('clears targets after a resize and ignores queued events from the old preview', async () => {
  const { view, onSelect } = await setup()
  const oldDetection = view.getByTestId('scanner-camera').props.onBarcodeScanned
  await act(async () => { oldDetection(detection) })
  await act(async () => { fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 640, height: 360 } } }) })
  await act(async () => { oldDetection(detection) })
  expect(view.queryByLabelText('QR Code 1')).toBeNull()
  expect(onSelect).not.toHaveBeenCalled()
})

it('discards targets on background and requires a fresh detection on return', async () => {
  let onState: ((state: AppStateStatus) => void) | undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onState = listener
    return { remove: jest.fn() }
  })
  const { view, onSelect } = await setup()
  const oldDetection = view.getByTestId('scanner-camera').props.onBarcodeScanned
  await act(async () => { oldDetection(detection) })
  await act(async () => { onState!('background') })
  expect(view.queryByTestId('scanner-camera')).toBeNull()
  await act(async () => { onState!('active'); oldDetection(detection) })
  expect(view.queryByLabelText('QR Code 1')).toBeNull()
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', detection) })
  await act(async () => { fireEvent.press(view.getByLabelText('QR Code 1')) })
  expect(onSelect).toHaveBeenCalledTimes(1)
})

it('shows a translated retry after a camera error, without submitting a code', async () => {
  const { view, onSelect } = await setup('zh')
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'mountError', { message: 'camera unavailable' }) })
  expect(view.getByText('无法启动相机，请重试。')).toBeTruthy()
  expect(view.queryByTestId('scanner-camera')).toBeNull()
  await act(async () => { fireEvent.press(view.getByText('重试')) })
  expect(view.getByTestId('scanner-camera')).toBeTruthy()
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', detection) })
  await act(async () => { fireEvent.press(view.getByLabelText('二维码 1')) })
  expect(onSelect).toHaveBeenCalledWith(detection)
})

it('cancels without submitting and ignores late camera callbacks', async () => {
  const { view, onSelect, onCancel } = await setup()
  const callback = view.getByTestId('scanner-camera').props.onBarcodeScanned
  await act(async () => { fireEvent.press(view.getByText('Cancel Scan')) })
  await act(async () => { callback(detection) })
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onSelect).not.toHaveBeenCalled()
  expect(view.queryByLabelText('QR Code 1')).toBeNull()
})

it.each(['light', 'dark'] as const)('renders positioned, translated targets in %s mode without exposing QR payloads', async (theme) => {
  const { view } = await setup('zh', theme)
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', detection) })
  expect(view.getByLabelText('二维码 1')).toHaveStyle({ left: 20, top: 100, width: 100, height: 100 })
  expect(view.getByText('点击要使用的二维码。')).toBeTruthy()
  expect(view.queryByText(detection.data)).toBeNull()
  expect(view.queryByLabelText(detection.data)).toBeNull()
})
