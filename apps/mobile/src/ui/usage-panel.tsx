import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'
import type { CodexRateLimitResetOutcome, RemoteUsage } from '@superone/shared/agent-types'
import { formatTokens } from '@superone/shared/format-tokens'
import { Text } from './text'
import { ProviderBrand } from './provider-brand'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import {
  activeRateLimit, formatResetIn, remainingPercent, updatedAgoMinutes, usageTone,
  type LiveRateLimit, type MeterTone,
} from '../harness-usage'

/** Everything the meter chip needs about the credential's subscription, owned by the shell. */
export type UsageMeterProps = {
  usage: RemoteUsage | null
  refreshing?: boolean
  /** The live `rate_limit` event on the open session, if any. */
  rateLimit?: LiveRateLimit | null
  /** Panel opened: the owner force-reads when the reading is stale. */
  onOpen?: () => void
  onRefresh?: () => void
  onConsumeResetCredit?: (creditId: string | null) => Promise<CodexRateLimitResetOutcome | null>
}

const RESET_OUTCOME_COPY: Record<CodexRateLimitResetOutcome, string> = {
  reset: 'Usage reset',
  nothingToReset: 'Nothing to reset',
  noCredit: 'No credit available',
  alreadyRedeemed: 'Already redeemed',
  unknown: 'Could not reset',
}

/** Brand lockup for the meter's title; a gateway with no mark falls back to its name. */
export function usageBrandKey(usage: RemoteUsage): string | null {
  if (usage.kind === 'claude') return 'claude'
  if (usage.kind === 'codex') return 'openai'
  // The host only shapes an ACP meter for Grok (the one ACP agent with billing).
  if (usage.kind === 'acp') return 'grok'
  const title = usage.title.toLowerCase()
  if (title.includes('glm') || title.includes('zhipu')) return 'zhipu'
  if (title.includes('minimax')) return 'minimax'
  return null
}

export function useToneColor() {
  const { tokens: { colors } } = useMobileTheme()
  return (tone: MeterTone) => tone === 'error' ? colors.error : tone === 'warning' ? colors.warning : colors.success
}

/** Refresh control for the menu title row — the desktop popover's footer button, moved up. */
export function UsageRefreshAccessory({ refreshing, onRefresh }: Pick<UsageMeterProps, 'refreshing' | 'onRefresh'>) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  if (!onRefresh) return null
  return <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
    <Pressable disabled={refreshing} accessibilityRole="button" accessibilityLabel={t('Refresh usage')} onPress={onRefresh}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      {refreshing ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={15} color={colors.mutedForeground} />}
    </Pressable>
  </View>
}

function Row({ label, value, tone }: { label: string; value: string; tone?: MeterTone }) {
  const { tokens: { colors } } = useMobileTheme()
  const toneColor = useToneColor()
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: tone ? toneColor(tone) : colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>{value}</Text>
  </View>
}

function WindowRow({ label, usedPercent, resetsAt }: { label: string; usedPercent: number; resetsAt: number | null }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const toneColor = useToneColor()
  const remaining = remainingPercent(usedPercent)
  const fill = toneColor(usageTone(usedPercent))
  const resetIn = formatResetIn(resetsAt)
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {resetIn ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          {resetIn === 'soon' ? t('Resets soon') : `${t('Resets in')} ${resetIn}`} ·
        </Text> : null}
        <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
          {remaining}% {t('left')}
        </Text>
      </View>
    </View>
    <View style={{ height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.muted }}>
      <View style={{ width: `${remaining}%`, height: '100%', backgroundColor: fill }} />
    </View>
  </View>
}

function ResetCredits({ usage, onConsume }: { usage: RemoteUsage; onConsume: UsageMeterProps['onConsumeResetCredit'] }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const redeemable = usage.resetCreditList?.filter((credit) => credit.status !== 'redeemed') ?? []
  const count = usage.resetCredits ?? 0
  if (redeemable.length === 0 && count <= 0) return null

  const redeem = async (creditId: string | null) => {
    if (!onConsume) return
    setBusyId(creditId ?? '__all__')
    setNote(null)
    try {
      const outcome = await onConsume(creditId)
      setNote(RESET_OUTCOME_COPY[outcome ?? 'unknown'])
    } finally {
      setBusyId(null)
    }
  }
  const button = (creditId: string | null, disabled: boolean) => {
    const busy = busyId === (creditId ?? '__all__')
    return <Pressable accessibilityRole="button" disabled={disabled || busy || !onConsume} onPress={() => { void redeem(creditId) }}
      style={({ pressed }) => ({ paddingHorizontal: 10, minHeight: 28, justifyContent: 'center', borderRadius: radius.md,
        borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <Text style={{ color: colors.foreground, fontSize: 12 }}>{busy ? t('Resetting…') : t('Reset now')}</Text>
    </Pressable>
  }

  return <View style={{ gap: 6 }}>
    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Reset credits')}</Text>
    {redeemable.length > 0
      ? redeemable.map((credit) => <View key={credit.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12 }}>{credit.title ?? t('Rate limit reset')}</Text>
          {credit.expiresAt != null ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {t('Expires')} {new Date(credit.expiresAt * 1000).toLocaleDateString()}
          </Text> : null}
        </View>
        {button(credit.id, credit.status !== 'available')}
      </View>)
      : <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingLeft: 8 }}>
        <Text style={{ color: colors.foreground, fontSize: 12, fontVariant: ['tabular-nums'] }}>{count}</Text>
        {button(null, false)}
      </View>}
    {note ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{t(note)}</Text> : null}
  </View>
}

function CodexStats({ usage }: { usage: RemoteUsage }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const stats = usage.codexAccount
  if (!stats) return null
  const rows: Array<[string, string]> = []
  if (stats.lifetimeTokens != null) rows.push([t('Lifetime tokens'), formatTokens(stats.lifetimeTokens)])
  if (stats.peakDailyTokens != null) rows.push([t('Peak daily'), formatTokens(stats.peakDailyTokens)])
  if (stats.currentStreakDays != null) rows.push([t('Streak'), `${stats.currentStreakDays}d`])
  if (stats.threadUsage) {
    const threadTokens = stats.threadUsage.groups.reduce((total, group) => total + (group.totalTokens ?? 0), 0)
    if (threadTokens > 0) rows.push([t('Thread tokens'), formatTokens(threadTokens)])
    rows.push([t('Estimated credits'), (stats.threadUsage.estimatedUsageCreditsMicros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })])
  }
  if (rows.length === 0) return null
  return <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
    {rows.map(([label, value]) => <Row key={label} label={label} value={value} />)}
  </View>
}

/**
 * The subscription half of the meter panel: the desktop `RateLimitGauge`
 * popover, section by section, on one `RemoteUsage`. Nothing here knows which
 * harness answered — that is the host's job (`readHarnessUsage`).
 */
export function UsagePanel({ usage, rateLimit, onConsumeResetCredit }: Pick<UsageMeterProps, 'usage' | 'rateLimit' | 'onConsumeResetCredit'>) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const toneColor = useToneColor()
  const live = activeRateLimit(rateLimit)
  const livePercent = live?.utilization != null ? Math.round(live.utilization * 100) : null
  const liveReset = live ? formatResetIn(live.resetsAt ?? null) : null
  // The live event can arrive before any polled reading (a harness whose meter
  // is not exposed, or a first turn rejected outright): the note stands alone
  // and carries the numbers. With a reading, the window rows below already
  // show usage and reset, so the note is just the label.
  const liveDetail = live && !usage ? [
    livePercent != null && live.status !== 'rejected' ? `${livePercent}% ${t('used')}` : null,
    liveReset ? (liveReset === 'soon' ? t('Resets soon') : `${t('Resets in')} ${liveReset}`) : null,
  ].filter(Boolean) : []
  const liveNote = live ? <Text accessibilityRole="alert" style={{ color: toneColor(live.status === 'rejected' ? 'error' : 'warning'), fontSize: 12 }}>
    {[live.status === 'rejected' ? t('Rate limited') : t('Approaching limit'), ...liveDetail].join(' · ')}
  </Text> : null
  if (!usage) return liveNote
  const agoMinutes = updatedAgoMinutes(usage.fetchedAt)

  return <View style={{ gap: 8 }}>
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <ProviderBrand brandKey={usageBrandKey(usage)} name={usage.title} size={14} />
        {usage.planType ? <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{usage.planType}</Text> : null}
      </View>
      {usage.account ? <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11 }}>{usage.account}</Text> : null}
    </View>
    {liveNote}
    {usage.windows.map((window) => <WindowRow key={window.label} label={window.label} usedPercent={window.usedPercent} resetsAt={window.resetsAt} />)}
    {usage.extraUsage ? <Row label={t('Extra usage')}
      value={`$${usage.extraUsage.usedDollars.toFixed(2)}${usage.extraUsage.limitDollars != null ? ` / $${usage.extraUsage.limitDollars.toFixed(2)}` : ''}`} /> : null}
    {usage.creditBalanceDollars != null ? <Row label={t('Credit balance')} value={`$${usage.creditBalanceDollars.toFixed(2)}`} /> : null}
    <ResetCredits usage={usage} onConsume={onConsumeResetCredit} />
    <CodexStats usage={usage} />
    {agoMinutes != null ? <Text style={{ color: colors.mutedForeground, fontSize: 10, opacity: 0.8 }}>
      {agoMinutes === 0 ? t('Updated just now') : `${t('Updated')} ${agoMinutes}m ${t('ago')}`}
    </Text> : null}
  </View>
}
