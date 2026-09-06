import { Pressable, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { formatTokens } from '@superone/shared/format-tokens'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'

// Sized so the ring reads at the same optical weight as the 16px lucide glyphs
// beside it — a 16px box would draw a 12px circle and look like a smaller control.
const SIZE = 18
const CENTER = SIZE / 2
const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export type ContextRingProps = {
  tokens: number
  /** `null` when no catalog or harness reported a window for the active model. */
  contextWindow: number | null
  costUsd: number
}

/**
 * Context occupancy, mirroring the desktop status bar's ring — same thresholds and
 * same numbers, so a session read on the phone and on the desktop agree. The arc
 * alone is the resting state; the percentage and the breakdown are one tap away.
 *
 * Renders nothing until the session has spent something. A ring at 0% next to a
 * fresh session is noise, and it is also a lie for the harnesses that only report
 * usage once the first turn completes.
 */
export function ContextRing({ tokens, contextWindow, costUsd }: ContextRingProps) {
  const menu = useMenuAnchor()
  const { tokens: theme } = useMobileTheme()
  const { colors } = theme

  if (tokens === 0 && costUsd === 0) return null

  const hasWindow = contextWindow != null && contextWindow > 0
  const occupancy = hasWindow ? Math.min(tokens / contextWindow, 1) : 0
  const percent = hasWindow ? Math.round((tokens / contextWindow) * 100) : 0
  const exceeded = hasWindow ? tokens > contextWindow : false
  const fill = exceeded || occupancy > 0.7
    ? colors.error
    : occupancy > 0.4 ? colors.warning : colors.success
  const usedLabel = formatTokens(tokens)
  const maxLabel = hasWindow ? formatTokens(contextWindow) : null
  const arc = CIRCUMFERENCE * occupancy

  return <>
    <Pressable ref={menu.ref} accessibilityRole="button"
      accessibilityLabel={hasWindow ? `Context used: ${percent}%` : `Context used: ${usedLabel} tokens`}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={menu.open}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center',
        borderRadius: 8, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={colors.mutedForeground} strokeOpacity={0.35} strokeWidth={2} />
        {hasWindow
          ? occupancy > 0 && <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={fill} strokeWidth={2}
            strokeDasharray={`${arc} ${CIRCUMFERENCE - arc}`} strokeDashoffset={CIRCUMFERENCE * 0.25} strokeLinecap="round" />
          : <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={colors.mutedForeground} strokeWidth={2} />}
      </Svg>
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Context" onDismiss={menu.close} width={240}>
      <View style={{ padding: 8, gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: exceeded ? colors.error : colors.foreground, fontSize: 20, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
            {hasWindow ? `${percent}%` : `${usedLabel} tokens`}
          </Text>
          {maxLabel ? <Text style={{ color: colors.mutedForeground, fontSize: 12, fontVariant: ['tabular-nums'] }}>
            {usedLabel} / {maxLabel} tokens
          </Text> : null}
        </View>
        {exceeded ? <Text style={{ color: colors.error, fontSize: 12 }}>Exceeds the model’s context window</Text> : null}
        <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.muted }}>
          <View style={{ width: `${hasWindow ? Math.round(occupancy * 100) : 100}%`, height: '100%', backgroundColor: fill }} />
        </View>
        {hasWindow ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Free</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>
            {formatTokens(Math.max(0, contextWindow - tokens))}
          </Text>
        </View> : null}
        {costUsd > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Cost</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>${costUsd.toFixed(4)}</Text>
        </View> : null}
      </View>
    </AnchoredMenu>
  </>
}
