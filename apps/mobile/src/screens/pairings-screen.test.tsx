import { expect, it, jest } from '@jest/globals'
import type { SavedPairing } from '@superone/relay-client'
import { renderWithTheme } from '../test-render'
import { PairingsScreen } from './pairings-screen'

jest.mock('expo-camera', () => ({ CameraView: () => null }))
jest.mock('../ui/device-row', () => ({
  DeviceRow: () => null,
  deviceLabel: (pairing: { hostName?: string }) => pairing.hostName ?? '',
}))

function pairing(id: string): SavedPairing {
  return { id, hostName: id, relayUrl: 'wss://relay.example', secret: 'a'.repeat(64) }
}

function screen(pairings: SavedPairing[]) {
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
    onConnect={jest.fn()}
    onRename={jest.fn()}
    onForget={jest.fn()}
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
