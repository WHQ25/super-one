import { expect, it, jest } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import type { ComponentProps } from 'react'
import { AppState } from 'react-native'
import type { SavedPairing } from '@superone/relay-client'
import { renderWithTheme } from '../test-render'
import { PairingsScreen } from './pairings-screen'

jest.mock('expo-camera', () => {
  const { View } = require('react-native')
  return { CameraView: (props: object) => <View {...props} testID="scanner-camera" /> }
})
jest.mock('../ui/device-row', () => ({
  DeviceRow: () => null,
  deviceLabel: (pairing: { hostName?: string }) => pairing.hostName ?? '',
}))

function pairing(id: string): SavedPairing {
  return { id, hostName: id, relayUrl: 'wss://relay.example', secret: 'a'.repeat(64) }
}

function screen(pairings: SavedPairing[], onOpenSettings = jest.fn(), overrides: Partial<ComponentProps<typeof PairingsScreen>> = {}) {
  return <PairingsScreen
    scannerOpen={false}
    paste=""
    lan=""
    code={null}
    pairings={pairings}
    statusOf={() => 'offline'}
    reconnect={null}
    activePairingId={null}
    connectingPairingId={null}
    refreshing={false}
    onRefresh={jest.fn()}
    onBarcodeScanned={jest.fn()}
    onCancelScanner={jest.fn()}
    onPasteChange={jest.fn()}
    onLanChange={jest.fn()}
    onPair={jest.fn()}
    onOpenScanner={jest.fn()}
    onCancelPairing={jest.fn()}
    onOpenSettings={onOpenSettings}
    onConnect={jest.fn()}
    onRename={jest.fn()}
    onForget={jest.fn()}
    {...overrides}
  />
}

it('drops the device section and keeps the hint under the pair button when nothing is paired', async () => {
  const view = await renderWithTheme(screen([]))
  expect(view.queryByText('My Devices')).toBeNull()
  expect(view.getByText('Pair New Device')).toBeTruthy()
  expect(view.getByText('Scan the QR code from your desktop app to pair a device.')).toBeTruthy()
})

it('lists the devices under the wordmark with the pair button right after them', async () => {
  const view = await renderWithTheme(screen([pairing('desk-a'), pairing('desk-b')]))
  expect(view.getByText('My Devices')).toBeTruthy()
  expect(view.getByText('2')).toBeTruthy()
  expect(view.queryByText('Scan the QR code from your desktop app to pair a device.')).toBeNull()
  // Only the list may shrink: the wordmark and the button keep their size when
  // the devices outgrow the screen, and the group stays centred when they do not.
  expect(view.getByTestId('device-list')).toHaveStyle({ flexGrow: 0, flexShrink: 1 })
})

it('opens settings from the device list before any device is connected', async () => {
  const onOpenSettings = jest.fn()
  const view = await renderWithTheme(screen([], onOpenSettings))
  await fireEvent.press(view.getByLabelText('Settings'))
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
})

it('waits for a tap and submits the chosen QR rather than the first detected one', async () => {
  AppState.currentState = 'active'
  const onSelect = jest.fn()
  const view = await renderWithTheme(screen([], jest.fn(), { scannerOpen: true, onBarcodeScanned: onSelect }))
  const download = { type: 'qr', data: 'https://example.com/mobile.apk', cornerPoints: [], bounds: { origin: { x: 20, y: 50 }, size: { width: 100, height: 100 } } }
  const pairing = { ...download, data: 'superone://pair?channel=selected', bounds: { origin: { x: 180, y: 240 }, size: { width: 100, height: 100 } } }

  await act(async () => { fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', download) })
  expect(onSelect).not.toHaveBeenCalled()

  await act(async () => { fireEvent(view.getByTestId('qr-scanner'), 'layout', { nativeEvent: { layout: { width: 360, height: 640 } } }) })
  await act(async () => {
    fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', download)
    fireEvent(view.getByTestId('scanner-camera'), 'barcodeScanned', pairing)
  })
  expect(view.getByLabelText('QR Code 1')).toBeTruthy()
  const second = view.getByLabelText('QR Code 2')
  await act(async () => { fireEvent.press(second) })
  await act(async () => { fireEvent.press(second) })
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(onSelect).toHaveBeenCalledWith(pairing)
})
