import { useEffect, useMemo, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, Wifi, type LucideIcon } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from './text'
import { SpinningIcon } from './spinning-icon'
import { WifiCycleIcon } from './wifi-cycle-icon'
import { useMobileTheme } from '../theme/context'
import {
  describeDeviceStatus,
  type DeviceStatus,
  type DeviceStatusGlyph,
  type DeviceStatusTone,
  type ReconnectInfo,
} from '../device-status'
import { useMobileLocale } from '../i18n/context'

const GLYPHS: Record<Exclude<DeviceStatusGlyph, 'wifi-search'>, LucideIcon> = {
  wifi: Wifi,
  cloud: Cloud,
  'cloud-off': CloudOff,
  sync: RefreshCw,
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
  const { t } = useMobileLocale()
  const styles = useStyles()
  const waiting = props.reconnect?.waiting === true && props.reconnect.nextAtMs !== null
  const now = useSecondTicker(waiting)
  const view = describeDeviceStatus(props.status, { reconnect: props.reconnect, nowMs: now })
  const label = t(view.label)
  const color = toneColor(view.tone, tokens.colors)
  const size = props.iconSize ?? 13
  return (
    <View accessibilityLabel={label} style={styles.row}>
      <StatusGlyph glyph={view.glyph} spin={view.spin} size={size} color={color} />
      {props.showLabel === false ? null : (
        <Text numberOfLines={1} style={[styles.label, { color, fontSize: props.fontSize ?? 12 }]}>
          {label}
        </Text>
      )}
    </View>
  )
}

function StatusGlyph(props: {
  glyph: DeviceStatusGlyph
  spin: boolean
  size: number
  color: string
}) {
  if (props.glyph === 'wifi-search') {
    return <WifiCycleIcon size={props.size} color={props.color} />
  }
  const Icon = GLYPHS[props.glyph]
  return props.spin
    ? <SpinningIcon icon={Icon} size={props.size} color={props.color} />
    : <Icon color={props.color} size={props.size} />
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
