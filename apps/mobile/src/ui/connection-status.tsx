import { useEffect, useMemo, useState } from 'react'
import { Cloud, CloudOff, Radar, RefreshCw, Wifi, type LucideIcon } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from './text'
import { SpinningIcon } from './spinning-icon'
import { useMobileTheme } from '../theme/context'
import {
  describeDeviceStatus,
  type DeviceStatus,
  type DeviceStatusGlyph,
  type DeviceStatusTone,
  type ReconnectInfo,
} from '../device-status'

const GLYPHS: Record<DeviceStatusGlyph, LucideIcon> = {
  wifi: Wifi,
  cloud: Cloud,
  'cloud-off': CloudOff,
  sync: RefreshCw,
  radar: Radar,
}

/** Re-render once a second, only while a countdown is actually on screen. */
function useSecondTicker(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

export function ConnectionStatusIndicator(props: {
  status: DeviceStatus
  reconnect?: ReconnectInfo | null
  showLabel?: boolean
  iconSize?: number
  fontSize?: number
}) {
  const { tokens } = useMobileTheme()
  const styles = useStyles()
  const waiting = props.reconnect?.waiting === true && props.reconnect.nextAtMs !== null
  const now = useSecondTicker(waiting)
  const view = describeDeviceStatus(props.status, { reconnect: props.reconnect, nowMs: now })
  const color = toneColor(view.tone, tokens.colors)
  const size = props.iconSize ?? 13
  const Icon = GLYPHS[view.glyph]

  return (
    <View accessibilityLabel={view.label} style={styles.row}>
      {view.spin
        ? <SpinningIcon icon={Icon} size={size} color={color} />
        : <Icon color={color} size={size} />}
      {props.showLabel === false ? null : (
        <Text numberOfLines={1} style={[styles.label, { color, fontSize: props.fontSize ?? 12 }]}>
          {view.label}
        </Text>
      )}
    </View>
  )
}

function toneColor(
  tone: DeviceStatusTone,
  colors: ReturnType<typeof useMobileTheme>['tokens']['colors'],
): string {
  if (tone === 'success') return colors.success
  if (tone === 'danger') return colors.error
  if (tone === 'warning') return colors.warning
  if (tone === 'muted') return colors.mutedForeground
  return colors.foreground
}

function useStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    row: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.xs },
    label: { fontWeight: '500', flexShrink: 1 },
  }), [tokens])
}
