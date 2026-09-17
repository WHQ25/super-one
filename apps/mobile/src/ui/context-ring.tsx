import { Pressable, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { formatTokens } from '@superone/shared/format-tokens'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, useMenuAnchor } from './anchored-menu'
import { CHIP_HEIGHT, CHIP_HIT_SLOP, chipTriggerBackground } from './chip-metrics'
import { useMobileLocale } from '../i18n/context'
import { activeRateLimit, usageBadgeWindow, usageTone } from '../harness-usage'
import { UsagePanel, UsageRefreshAccessory, useToneColor, type UsageMeterProps } from './usage-panel'

// Sized so the ring reads at the same optical weight as the 16px lucide glyphs
// beside it — a 16px box would draw a 12px circle and look like a smaller control.
const SIZE = 18
const CENTER = SIZE / 2
const RADIUS = 7
// With a subscription meter the chip is two concentric rings: the outer one is
// the account (the slower, larger number), the inner one is this session's
// context. Both stay inside the same 18px box so the chip row does not move.
const OUTER_RADIUS = 7.5
const INNER_RADIUS = 4

export type ContextRingProps = {
  tokens: number
  /** `null` when no catalog or harness reported a window for the active model. */
  contextWindow: number | null
  costUsd: number
  /** The credential's subscription meter; absent for harnesses without one. */
  usage?: UsageMeterProps
}

function Arc({ radius, fraction, color, trackOpacity = 0.35 }: { radius: number; fraction: number; color: string; trackOpacity?: number }) {
  const { tokens: { colors } } = useMobileTheme()
  const circumference = 2 * Math.PI * radius
  const arc = circumference * Math.min(Math.max(fraction, 0), 1)
  return <>
    <Circle cx={CENTER} cy={CENTER} r={radius} fill="none" stroke={colors.mutedForeground} strokeOpacity={trackOpacity} strokeWidth={2} />
    {arc > 0 && <Circle cx={CENTER} cy={CENTER} r={radius} fill="none" stroke={color} strokeWidth={2}
      strokeDasharray={`${arc} ${circumference - arc}`} strokeDashoffset={circumference * 0.25} strokeLinecap="round" />}
  </>
}

/** The numbers both the chip and its panel draw, derived once from the props. */
function useRingModel({ tokens, contextWindow, costUsd, usage: meter }: ContextRingProps) {
  const { tokens: { colors } } = useMobileTheme()
  const usage = meter?.usage ?? null
  const live = activeRateLimit(meter?.rateLimit)
  const hasContext = tokens > 0 || costUsd > 0
  const hasWindow = contextWindow != null && contextWindow > 0
  const occupancy = hasWindow ? Math.min(tokens / contextWindow, 1) : 0
  const exceeded = hasWindow ? tokens > contextWindow : false
  return {
    usage, live, hasContext, hasWindow, occupancy, exceeded,
    hasReading: !!usage || !!live,
    percent: hasWindow ? Math.round((tokens / contextWindow) * 100) : 0,
    contextFill: exceeded || occupancy > 0.7 ? colors.error : occupancy > 0.4 ? colors.warning : colors.success,
    usedLabel: formatTokens(tokens),
    maxLabel: hasWindow ? formatTokens(contextWindow) : null,
    badge: usageBadgeWindow(usage),
  }
}

/**
 * Context occupancy, mirroring the desktop status bar's ring — same thresholds and
 * same numbers, so a session read on the phone and on the desktop agree. The arc
 * alone is the resting state; the percentage and the breakdown are one tap away.
 *
 * When the session bills a subscription the same chip carries that meter as an
 * outer ring (the desktop keeps it in the sidebar footer, which the phone does
 * not have), and the panel gains the subscription section below the context one.
 *
 * Always on screen: an empty track on a fresh session is the affordance for
 * opening the panel and pulling the meter by hand, which matters for the
 * harnesses that only answer once a runtime is up (Grok) or that the host had
 * not read yet.
 */
export function ContextRing(props: ContextRingProps) {
  const { usage: meter } = props
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const toneColor = useToneColor()
  const { usage, live, hasContext, hasReading, hasWindow, occupancy, percent, contextFill, usedLabel, badge } = useRingModel(props)

  const usageFill = badge ? toneColor(usageTone(badge.usedPercent)) : colors.mutedForeground

  const open = () => { meter?.onOpen?.(); menu.open() }
  const contextLabel = hasWindow ? `${t('Context used:')} ${percent}%` : `${t('Context used:')} ${usedLabel} ${t('tokens')}`
  const usageLabel = badge
    ? `${t('Usage left:')} ${100 - Math.round(badge.usedPercent)}%`
    : live ? t(live.status === 'rejected' ? 'Rate limited' : 'Approaching limit') : null
  const label = [usageLabel, hasContext ? contextLabel : null].filter(Boolean).join(', ') || t(meter ? 'Usage' : 'Context')
  // Before anything is spent the ring is a bare track, not a full muted circle
  // pretending to be a reading.
  const contextArc = hasContext ? (hasWindow ? occupancy : 1) : 0
  const contextArcColor = hasWindow ? contextFill : colors.mutedForeground

  return <>
    <Pressable ref={menu.ref} accessibilityRole="button" testID="context-ring" accessibilityLabel={label}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={open} hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => ({ minHeight: CHIP_HEIGHT, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', borderRadius: 8,
        backgroundColor: chipTriggerBackground({ pressed, open: !!menu.anchor }, colors.muted) })}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {hasReading
          ? <>
            <Arc radius={OUTER_RADIUS} fraction={badge ? badge.usedPercent / 100 : 0} color={usageFill} />
            {hasContext ? <Arc radius={INNER_RADIUS} fraction={contextArc} color={contextArcColor} trackOpacity={0.25} /> : null}
          </>
          : <Arc radius={RADIUS} fraction={contextArc} color={contextArcColor} />}
      </Svg>
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title={meter ? 'Usage' : 'Context'} onDismiss={menu.close} width={usage ? 280 : 240}
      titleAccessory={meter ? <UsageRefreshAccessory refreshing={meter.refreshing} onRefresh={meter.onRefresh} /> : undefined}>
      <ContextRingPanel {...props} />
    </AnchoredMenu>
  </>
}

/** The chip's popover body; exported so it can be rendered without the native anchor measurement. */
export function ContextRingPanel(props: ContextRingProps) {
  const { tokens, contextWindow, costUsd, usage: meter } = props
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { usage, hasContext, hasReading, hasWindow, occupancy, percent, exceeded, contextFill, usedLabel, maxLabel } = useRingModel(props)

  return <View style={{ padding: 8, gap: 12 }}>
    {hasReading
      ? <UsagePanel usage={usage} rateLimit={meter?.rateLimit} onConsumeResetCredit={meter?.onConsumeResetCredit} />
      : meter ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('No usage data yet')}</Text> : null}
    {hasContext ? <View style={{ gap: 8, ...(meter ? { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 } : {}) }}>
      {meter ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Context')}</Text> : null}
      <View style={{ gap: 2 }}>
        <Text style={{ color: exceeded ? colors.error : colors.foreground, fontSize: 20, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
          {hasWindow ? `${percent}%` : `${usedLabel} ${t('tokens')}`}
        </Text>
        {maxLabel ? <Text style={{ color: colors.mutedForeground, fontSize: 12, fontVariant: ['tabular-nums'] }}>
          {usedLabel} / {maxLabel} {t('tokens')}
        </Text> : null}
      </View>
      {exceeded ? <Text style={{ color: colors.error, fontSize: 12 }}>{t('Exceeds the model’s context window')}</Text> : null}
      <View style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.muted }}>
        <View style={{ width: `${hasWindow ? Math.round(occupancy * 100) : 100}%`, height: '100%', backgroundColor: contextFill }} />
      </View>
      {contextWindow != null && hasWindow ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Free')}</Text>
        <Text style={{ color: colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>
          {formatTokens(Math.max(0, contextWindow - tokens))}
        </Text>
      </View> : null}
      {costUsd > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Cost')}</Text>
        <Text style={{ color: colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>${costUsd.toFixed(4)}</Text>
      </View> : null}
    </View> : null}
  </View>
}
