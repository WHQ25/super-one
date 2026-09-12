import type { ComponentProps, ReactNode } from 'react'
import { View } from 'react-native'
import type { SavedPairing } from '@superone/relay-client'
import type { DeviceStatus } from '../device-status'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { PairingsScreen } from './pairings-screen'

const noop = () => {}

function device(id: string, hostName: string, lan?: string): SavedPairing {
  return { id, hostName, lan, relayUrl: 'wss://relay.super-one.dev', secret: 'a'.repeat(64) }
}

const fewDevices: { pairing: SavedPairing; status: DeviceStatus }[] = [
  { pairing: device('desk-lan', 'Studio iMac', '192.168.1.9:8123'), status: 'onlineLan' },
  { pairing: device('desk-cloud', 'Office MacBook Pro'), status: 'onlineCloud' },
  { pairing: device('desk-offline', 'Old laptop'), status: 'offline' },
]

/** Enough rows to outgrow a phone, so only the list scrolls between the wordmark and the button. */
const manyDevices = Array.from({ length: 14 }, (_, index) => ({
  pairing: device(`desk-${index}`, `Desktop ${index + 1}`, index % 2 ? undefined : `192.168.1.${10 + index}:8123`),
  status: (['onlineLan', 'onlineCloud', 'offline', 'searchingLan'] as const)[index % 4],
}))

type Props = ComponentProps<typeof PairingsScreen>

function withDevices(rows: { pairing: SavedPairing; status: DeviceStatus }[]): Pick<Props, 'pairings' | 'statusOf'> {
  return {
    pairings: rows.map((row) => row.pairing),
    statusOf: (pairing) => rows.find((row) => row.pairing.id === pairing.id)?.status ?? 'offline',
  }
}

const base: Props = {
  scannerOpen: false,
  paste: '',
  lan: '',
  code: null,
  ...withDevices(fewDevices),
  reconnect: null,
  activePairingId: null,
  connectingPairingId: null,
  refreshing: false,
  onRefresh: noop,
  onBarcodeScanned: noop,
  onCancelScanner: noop,
  onPasteChange: noop,
  onLanChange: noop,
  onPair: noop,
  onOpenScanner: noop,
  onCancelPairing: noop,
  onConnect: noop,
  onRename: noop,
  onForget: noop,
}

function Frame({ children, width, height }: { children: ReactNode; width: number; height: number }) {
  const { tokens } = useMobileTheme()
  return <View style={{ width, height, padding: tokens.spacing.lg, backgroundColor: tokens.colors.background }}>{children}</View>
}

function Preview(props: Props & { frameHeight?: number; frameWidth?: number }) {
  const { frameHeight = 760, frameWidth = 390, ...screen } = props
  return (
    <MobileThemeProvider>
      <Frame width={frameWidth} height={frameHeight}><PairingsScreen {...screen} /></Frame>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/PairingsScreen',
  component: PairingsScreen,
  render: Preview,
  args: base,
}

export const FewDevices = {
  name: 'Few devices · wordmark, list and button centred as one group',
}

export const Empty = {
  name: 'No devices · pair button right under the wordmark',
  args: withDevices([]),
}

export const ManyDevices = {
  name: 'Many devices · list scrolls, wordmark and button stay',
  args: withDevices(manyDevices),
}

export const LandscapePhone = {
  name: 'Landscape phone · few devices already overflow',
  render: (props: Props) => <Preview {...props} frameWidth={844} frameHeight={390} />,
}

export const Connecting = {
  name: 'Connecting · other rows disabled',
  args: {
    ...withDevices([{ ...fewDevices[0]!, status: 'connecting' }, ...fewDevices.slice(1)]),
    connectingPairingId: 'desk-lan',
  },
}

export const Reconnecting = {
  name: 'Active device retrying',
  args: {
    ...withDevices([{ ...fewDevices[0]!, status: 'connecting' }, ...fewDevices.slice(1)]),
    activePairingId: 'desk-lan',
    reconnect: { attempting: false, waiting: true, delayMs: 16_000, nextAtMs: Date.now() + 9_000 },
  },
}

export const Refreshing = {
  args: { refreshing: true },
}

export const PairingCode = {
  name: 'Pairing code shown',
  args: { code: '123456' },
}
