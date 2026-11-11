import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, OctagonX } from 'lucide-react'
import { motion } from 'motion/react'
import { Popover, PopoverAnchor, PopoverContent } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import { formatUsageDuration } from '@superone/shared/subscription-usage-presentation'
import type { SubscriptionAlert } from '@superone/shared/subscription-alerts'

export const FORCE_REFRESH_ON_OPEN_STALE_MS = 5 * 60 * 1000
const RATE_LIMIT_TIP_MS = 6_000

export type RateLimitTipInfo = Partial<Pick<SubscriptionAlert, 'source' | 'windowId' | 'label' | 'exhaustsAt' | 'severity'>> & {
  status: 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
}

export type GaugeHighlight = 'warning' | 'error' | null

export function remainingPercent(usedPercent: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 - usedPercent)))
}

function formatResetTime(resetsAt?: number): string | null {
  if (!resetsAt) return null
  const date = new Date(resetsAt * 1000)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date)
}

function rateLimitTipKey(info: RateLimitTipInfo): string {
  if (info.source === 'forecast') return `forecast:${info.windowId}:${info.resetsAt}:${info.severity}`
  return `${info.status}:${info.resetsAt ?? ''}:${info.rateLimitType ?? ''}:${info.utilization != null ? Math.floor(info.utilization * 20) : ''}`
}

function isExpiredRateLimit(info: RateLimitTipInfo): boolean {
  return info.resetsAt != null && info.resetsAt * 1000 <= Date.now()
}

export function useRateLimitTip(sessionId: string | null, info: RateLimitTipInfo | null): RateLimitTipInfo | null {
  const [dismissedBySession, setDismissedBySession] = useState<Map<string, string>>(() => new Map())
  const activeInfo = info && !isExpiredRateLimit(info) ? info : null
  const key = activeInfo ? rateLimitTipKey(activeInfo) : null
  const dismissedKey = sessionId ? dismissedBySession.get(sessionId) ?? null : null
  const visible = !!sessionId && !!activeInfo && key != null && key !== dismissedKey

  useEffect(() => {
    if (!visible || !key || !sessionId) return
    const timer = window.setTimeout(() => {
      setDismissedBySession((prev) => {
        if (prev.get(sessionId) === key) return prev
        const next = new Map(prev)
        next.set(sessionId, key)
        return next
      })
    }, RATE_LIMIT_TIP_MS)
    return () => window.clearTimeout(timer)
  }, [visible, key, sessionId])

  useEffect(() => {
    if (!sessionId || activeInfo) return
    setDismissedBySession((prev) => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, activeInfo])

  return visible ? activeInfo : null
}

function RateLimitTipBubble({ tip }: { tip: RateLimitTipInfo }) {
  const { t } = useTranslation()
  const isRejected = tip.status === 'rejected'
  const isUrgent = isRejected || (tip.severity ?? 0) >= 2
  const resetLabel = formatResetTime(tip.resetsAt)
  const pct = tip.utilization != null ? Math.round(tip.utilization * 100) : null
  const title = isRejected ? t('usageGauge.rateLimit.limited') : tip.source === 'forecast' ? t('usageGauge.forecast.warning') : t('usageGauge.rateLimit.approaching')
  const details = [
    tip.label,
    tip.source === 'forecast' && tip.exhaustsAt != null ? t('usageGauge.forecast.eta', { time: formatUsageDuration(tip.exhaustsAt - Date.now()) }) : null,
    !isRejected && tip.source !== 'forecast' && pct != null ? t('usageGauge.rateLimit.percentUsed', { percent: pct }) : null,
    resetLabel ? t('usageGauge.rateLimit.resetsAt', { time: resetLabel }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <PopoverContent
      role="status"
      side="top"
      align="end"
      sideOffset={8}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className="pointer-events-none w-52 rounded-md border-0 bg-background p-2 text-xs shadow-none"
    >
      <div className="flex items-start gap-1.5">
        {isRejected
          ? <OctagonX className="mt-0.5 size-3.5 shrink-0 text-error" />
          : <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', isUrgent ? 'text-error' : 'text-warning')} />
        }
        <div className="min-w-0">
          <div className={cn('font-medium', isUrgent ? 'text-error' : 'text-warning')}>{title}</div>
          {details && <div className="mt-0.5 text-[11px] text-muted-foreground">{details}</div>}
        </div>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/60">
        <motion.div
          key={rateLimitTipKey(tip)}
          className={cn('h-full origin-left', isUrgent ? 'bg-error' : 'bg-warning')}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: RATE_LIMIT_TIP_MS / 1000, ease: 'linear' }}
        />
      </div>
    </PopoverContent>
  )
}

export function RateLimitTipHost({ tip, children }: { tip: RateLimitTipInfo | null; children: ReactNode }) {
  if (!children) return null
  return (
    <Popover open={tip !== null}>
      <PopoverAnchor asChild>
        <div>{children}</div>
      </PopoverAnchor>
      {tip && <RateLimitTipBubble key={rateLimitTipKey(tip)} tip={tip} />}
    </Popover>
  )
}
