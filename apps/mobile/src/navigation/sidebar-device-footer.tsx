import { Laptop, Power, Settings } from 'lucide-react-native'
import { View } from 'react-native'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import { useMobileTheme } from '../theme/context'
import { ConnectionStatusIndicator } from '../ui/connection-status'
import { IconButton } from '../ui/icon-button'
import { Text } from '../ui/text'

/** The single connection readout used at the bottom of either sidebar. */
export function SidebarDeviceFooter(props: {
  deviceName: string
  deviceStatus: DeviceStatus
  reconnect?: ReconnectInfo | null
  onDisconnect: () => void
  onOpenSettings: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 6,
      minHeight: 60, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Laptop size={20} color={colors.mutedForeground} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>
          {props.deviceName}
        </Text>
        <ConnectionStatusIndicator status={props.deviceStatus} reconnect={props.reconnect} iconSize={12} fontSize={11} />
      </View>
      <View style={{ flexDirection: 'row', marginRight: -8 }}>
        <IconButton icon={Power} label="Disconnect" onPress={props.onDisconnect} />
        <IconButton icon={Settings} label="Settings" onPress={props.onOpenSettings} />
      </View>
    </View>
  )
}
