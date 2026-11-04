import { useEffect, useState, type ReactNode } from 'react'
import { usageWindowTone, type UsageWindow } from '@superone/shared/subscription-usage'
import { availableResetGrants, extraUsageCopy, usageForecastCopy } from '@superone/shared/subscription-usage-presentation'
import type { ClaudeExtraUsage, ClaudeResetGrant } from '@superone/shared/agent-types'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

export function formatWindowLabel(minutes: number | null, t: TFunction): string {
  if (!minutes || minutes <= 0) return t('usageGauge.windowFallback')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function localizeWindowLabel(label: string, t: TFunction): string {
  if (label === '5 Hours' || label === '5-hour') {
    const translated = t('usageGauge.fiveHours')
    return translated === 'usageGauge.fiveHours' ? '5 Hours' : translated
  }
  if (label === 'Weekly') {
    const translated = t('usageGauge.weekly')
    return translated === 'usageGauge.weekly' ? 'Weekly' : translated
  }
  return label
}

export function formatResetIn(resetsAtSeconds: number | null, t: TFunction): string | null {
  if (!resetsAtSeconds) return null
  const diffMs = resetsAtSeconds * 1000 - Date.now()
  if (diffMs <= 0) return t('usageGauge.resetsSoon')
  const totalMin = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const time = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return t('usageGauge.resetsIn', { time })
}

export function formatCreditExpiry(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const TONE_BAR_CLASS = { success: 'bg-green-500', warning: 'bg-amber-500', error: 'bg-red-500' } as const

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function WindowBar(window: UsageWindow) {
  const { label, usedPercent, resetsAt } = window
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetIn = formatResetIn(resetsAt, t)
  const tone = usageWindowTone(window, now)
  const copy = usageForecastCopy(window, now)
  const color = TONE_BAR_CLASS[tone]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="opacity-70">{localizeWindowLabel(label, t)}</span>
        <span className="flex items-center gap-1.5">
          {resetIn && <span className="opacity-50">{resetIn} ·</span>}
          <span className="font-medium tabular-nums">{t('usageGauge.percentLeft', { percent: Math.round(remaining) })}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${remaining}%` }} />
      </div>
      {copy && <span className="text-[11px] text-muted-foreground">{t(`usageGauge.forecast.${copy.key}`, { time: copy.time })}</span>}
    </div>
  )
}

export function GroupedWindowBars({ windows }: { windows: UsageWindow[] }) {
  const hasGroups = windows.some((w) => w.label.includes(' · '))
  if (!hasGroups) {
    return (
      <>
        {windows.map((w) => (
          <WindowBar key={w.id ?? w.label} {...w} />
        ))}
      </>
    )
  }

  const groups: Array<{ title: string; items: UsageWindow[] }> = []
  for (const w of windows) {
    const sep = w.label.indexOf(' · ')
    const title = sep >= 0 ? w.label.slice(0, sep).trim() : ''
    const shortLabel = sep >= 0 ? w.label.slice(sep + 3).trim() : w.label
    let group = groups.find((g) => g.title === title)
    if (!group) {
      group = { title, items: [] }
      groups.push(group)
    }
    group.items.push({ ...w, label: shortLabel })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((group, idx) => (
        <div
          key={group.title || idx}
          className={cn('flex flex-col gap-1.5', idx > 0 && 'border-t border-border/50 pt-2')}
        >
          {group.title && (
            <div className="text-[11px] font-medium text-muted-foreground">{group.title}</div>
          )}
          {group.items.map((w) => (
            <WindowBar key={w.id ?? `${group.title}:${w.label}`} {...w} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Spend beyond the plan; a capped allowance gets a bar of the share spent. */
export function ExtraUsageBar({ extra }: { extra: ClaudeExtraUsage }) {
  const { t } = useTranslation()
  const { value, usedPercent } = extraUsageCopy(extra)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="opacity-70">{t('usageGauge.extraUsage')}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      {usedPercent != null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
          <div className={cn('h-full rounded-full transition-all', TONE_BAR_CLASS[usageWindowTone({ usedPercent, resetsAt: null })])} style={{ width: `${usedPercent}%` }} />
        </div>
      )}
    </div>
  )
}

/** Claude's one-off limit resets, read-only: Claude Code offers them when a limit is hit. */
export function ResetGrantsRow({ grants }: { grants?: ClaudeResetGrant[] }) {
  const { t } = useTranslation()
  const available = availableResetGrants(grants)
  if (!available) return null
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="opacity-70">{t('usageGauge.resetCredits')}</span>
      <span className="flex items-center gap-1.5">
        {available.nextExpiresAt != null && <span className="opacity-50">{t('usageGauge.resetCreditExpires', { date: formatCreditExpiry(available.nextExpiresAt) })} ·</span>}
        <span className="font-medium tabular-nums">{available.count}</span>
      </span>
    </div>
  )
}
