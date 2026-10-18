import { afterEach, beforeEach, expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import { renderWithTheme } from '../test-render'
import { QR_AUTO_SELECT_MS } from './qr-scanner-state'
import { QrScanner } from './qr-scanner'

jest.mock('expo-camera', () => {
  const { View } = require('react-native')
  return { CameraView: (props: object) => <View {...props} testID="scanner-camera" /> }
})

const detection = {
  type: 'qr', data: 'https://example.com/any-qr', cornerPoints: [],
  bounds: { origin: { x: 20, y: 100 }, size: { width: 100, height: 100 } },
}
const neighbour = { ...detection, data: 'superone://pair?channel=other', bounds: { origin: { x: 200, y: 300 }, size: { width: 100, height: 100 } } }

beforeEach(() => { AppState.currentState = 'active'; jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

const advance = (ms: number) => act(async () => { jest.advanceTimersByTime(ms) })

async function setup(locale: 'en' | 'zh' = 'en', theme: 'light' | 'dark' = 'dark') {
  const onSelect = jest.fn()
  const onCancel = jest.fn()
  const view = await renderWithTheme(<QrScanner onSelect={onSelect} onCancel={onCancel} />, theme, locale)
  await act(async () => { fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 360, height: 640 } } }) })
  const scan = (...results: object[]) => act(async () => {
    for (const result of results) fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', result)
  })
  // A camera keeps reporting a code it can see, refreshing its expiry.
  const hold = async (...results: object[]) => {
    await scan(...results); await advance(QR_AUTO_SELECT_MS / 2)
    await scan(...results); await advance(QR_AUTO_SELECT_MS / 2)
  }
  return { view, onSelect, onCancel, scan, hold }
}

it('submits a lone QR once, after no neighbour appears within the settle window', async () => {
  const { view, onSelect, scan } = await setup()
  await scan(detection)
  expect(view.queryByLabelText('QR Code 1')).toBeNull()
  expect(view.getByText('Reading the QR code…')).toBeTruthy()
  await advance(QR_AUTO_SELECT_MS - 1)
  expect(onSelect).not.toHaveBeenCalled()
  await scan(detection)
  await advance(1)
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(detection)
  await scan(detection)
  await advance(QR_AUTO_SELECT_MS)
  expect(onSelect).toHaveBeenCalledTimes(1)
})

it('waits for a tap when a second QR arrives inside the window', async () => {
  const { view, onSelect, scan, hold } = await setup()
  await scan(detection)
  await advance(QR_AUTO_SELECT_MS - 100)
  await hold(detection, neighbour)
  expect(onSelect).not.toHaveBeenCalled()
  const second = view.getByLabelText('QR Code 2')
  await act(async () => { fireEvent.press(second) })
  await act(async () => { fireEvent.press(second) })
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(neighbour)
})

it('restarts the window when several codes narrow to one', async () => {
  const { view, onSelect, scan } = await setup()
  await scan(detection, neighbour)
  await advance(600)
  await scan(detection)
  // The neighbour expires on the 1000 ms sweep; the window starts from there.
  await advance(400)
  expect(view.queryByLabelText('QR Code 1')).toBeNull()
  await scan(detection)
  await advance(QR_AUTO_SELECT_MS / 2)
  await scan(detection)
  await advance(QR_AUTO_SELECT_MS / 2 - 1)
  expect(onSelect).not.toHaveBeenCalled()
  await advance(1)
  expect(onSelect).toHaveBeenCalledWith(detection)
})

it('keeps the hint height fixed so a state change cannot resize the preview', async () => {
  const { view, scan } = await setup()
  const height = () => view.getByTestId('qr-scanner-hint').props.style.flat().reduce((h: number | undefined, s: { height?: number }) => s?.height ?? h, undefined)
  const empty = height()
  await scan(detection)
  const reading = height()
  await scan(neighbour)
  expect(view.getByLabelText('QR Code 2')).toBeTruthy()
  expect([empty, reading, height()]).toEqual([empty, empty, empty])
  expect(empty).toBeGreaterThan(0)
  expect(view.getByTestId('qr-scanner-hint').props.numberOfLines).toBe(2)
})

it('does not submit a stale target even before the expiry timer paints', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
  const { view, onSelect, scan } = await setup()
  await scan(detection, neighbour)
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
  await advance(QR_AUTO_SELECT_MS)
  expect(onSelect).not.toHaveBeenCalled()
})

it('discards detections on background and requires a fresh one on return', async () => {
  let onState: ((state: AppStateStatus) => void) | undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onState = listener
    return { remove: jest.fn() }
  })
  const { view, onSelect, hold } = await setup()
  const oldDetection = view.getByTestId('scanner-camera').props.onBarcodeScanned
  await act(async () => { oldDetection(detection) })
  await act(async () => { onState!('background') })
  expect(view.queryByTestId('scanner-camera')).toBeNull()
  await act(async () => { onState!('active'); oldDetection(detection) })
  await advance(QR_AUTO_SELECT_MS)
  expect(onSelect).not.toHaveBeenCalled()
  await hold(detection)
  expect(onSelect).toHaveBeenCalledTimes(1)
})

it('shows a translated retry after a camera error, without submitting a code', async () => {
  const { view, onSelect, scan, hold } = await setup('zh')
  await scan(detection)
  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'mountError', { message: 'camera unavailable' }) })
  await advance(QR_AUTO_SELECT_MS)
  expect(onSelect).not.toHaveBeenCalled()
  expect(view.getByText('无法启动相机，请重试。')).toBeTruthy()
  expect(view.queryByTestId('scanner-camera')).toBeNull()
  await act(async () => { fireEvent.press(view.getByText('重试')) })
  await hold(detection)
  expect(onSelect).toHaveBeenCalledWith(detection)
})

it('cancels inside the window without submitting and ignores late camera callbacks', async () => {
  const { view, onSelect, onCancel, scan } = await setup()
  const callback = view.getByTestId('scanner-camera').props.onBarcodeScanned
  await scan(detection)
  await act(async () => { fireEvent.press(view.getByText('Cancel Scan')) })
  await act(async () => { callback(detection) })
  await advance(QR_AUTO_SELECT_MS)
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onSelect).not.toHaveBeenCalled()
})

it.each(['light', 'dark'] as const)('renders positioned, translated targets in %s mode without exposing QR payloads', async (theme) => {
  const { view, scan } = await setup('zh', theme)
  await scan(detection, neighbour)
  expect(view.getByLabelText('二维码 1')).toHaveStyle({ left: 20, top: 100, width: 100, height: 100 })
  expect(view.getByLabelText('二维码 2')).toHaveStyle({ left: 200, top: 300 })
  expect(view.getByText('发现多个二维码，请点击要使用的那个。')).toBeTruthy()
  expect(view.queryByText(detection.data)).toBeNull()
  expect(view.queryByLabelText(detection.data)).toBeNull()
})
