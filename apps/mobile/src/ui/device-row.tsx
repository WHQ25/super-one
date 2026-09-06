import { useMemo } from 'react'
import { ChevronRight, Laptop, PencilLine, Trash2 } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import type { SavedPairing } from '@superone/relay-client'
import { Text } from './text'
import { SwipeRow } from './swipe-row'
import { ConnectionStatusIndicator } from './connection-status'
import { useMobileTheme } from '../theme/context'
import type { DeviceStatus, ReconnectInfo } from '../device-status'

export function deviceLabel(pairing: SavedPairing): string {
  return pairing.name || pairing.hostName || pairing.relayUrl
}

export function DeviceRow(props: {
  pairing: SavedPairing
  status: DeviceStatus
  reconnect?: ReconnectInfo | null
  /** True while a different device is being dialled; only one connect at a time. */
  disabled?: boolean
  onPress: () => void
  onRename: () => void
  onForget: () => void
}) {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  const label = deviceLabel(props.pairing)
  return (
    <SwipeRow
      subject={label}
      onPress={() => { if (!props.disabled) props.onPress() }}
      actions={[
        { key: 'rename', label: 'Rename', icon: PencilLine, onPress: props.onRename },
        {
          key: 'forget',
          label: 'Forget',
          icon: Trash2,
          tone: 'destructive',
          onPress: props.onForget,
          confirm: {
            title: 'Forget device?',
            message: `Remove “${label}” from your paired devices?`,
            confirmLabel: 'Remove',
          },
        },
      ]}
    >
      <View style={[styles.card, props.disabled && styles.disabled]}>
        <View style={styles.iconBox}>
          <Laptop color={tokens.colors.mutedForeground} size={24} />
        </View>
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.title}>{label}</Text>
          <ConnectionStatusIndicator status={props.status} reconnect={props.reconnect} />
        </View>
        <ChevronRight color={tokens.colors.mutedForeground} size={20} />
      </View>
    </SwipeRow>
  )
}

function useStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    card: {
      alignItems: 'center',
      backgroundColor: tokens.colors.surface,
      borderColor: tokens.colors.border,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      flexDirection: 'row',
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: 14,
    },
    disabled: { opacity: 0.5 },
    iconBox: {
      alignItems: 'center',
      backgroundColor: tokens.colors.muted,
      borderRadius: 10,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    text: { flex: 1, gap: 3, minWidth: 0 },
    title: { color: tokens.colors.foreground, fontSize: 15, fontWeight: '600' },
  }), [tokens])
}
