import { View } from 'react-native'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { ConnectionStatusIndicator } from './connection-status'
import { DeviceRow } from './device-row'
import { Text } from './text'
import { WifiCycleIcon } from './wifi-cycle-icon'
import type { SavedPairing } from '@superone/relay-client'
import type { DeviceStatus } from '../device-status'

const pairing: SavedPairing = {
  id: 'desk-search',
  hostName: 'MacBook Pro',
  lan: '192.168.1.24:8123',
  relayUrl: 'wss://relay.super-one.dev',
  secret: 'a'.repeat(64),
}

const statuses: DeviceStatus[] = [
  'searchingLan', 'connecting', 'onlineLan', 'onlineCloud', 'connectedLan', 'connectedCloud', 'offline',
]

function Gallery() {
  const { tokens } = useMobileTheme()
  return (
    <View style={{ width: 320, padding: 16, gap: 16, backgroundColor: tokens.colors.background }}>
      <Text style={{ color: tokens.colors.mutedForeground, fontSize: 12 }}>wifi-zero → low → high → wifi · 250ms</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <WifiCycleIcon size={13} color={tokens.colors.mutedForeground} />
        <WifiCycleIcon size={24} color={tokens.colors.mutedForeground} />
      </View>
      <DeviceRow pairing={pairing} status="searchingLan" onPress={() => {}} onRename={() => {}} onForget={() => {}} />
      <View style={{ gap: 8 }}>
        {statuses.map((status) => (
          <ConnectionStatusIndicator key={status} status={status} />
        ))}
      </View>
    </View>
  )
}

export default {
  title: 'Mobile/WifiCycleIcon',
  component: WifiCycleIcon,
  render: () => <MobileThemeProvider><Gallery /></MobileThemeProvider>,
}
export const SearchingLocalNetwork = {}
