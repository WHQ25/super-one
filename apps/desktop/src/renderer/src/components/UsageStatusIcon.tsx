import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { AlertTriangle, Gauge, OctagonX, RefreshCw } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { useActiveSession, useChatStore } from '@/stores/chat'
import type { ClaudeExtraUsage, ClaudeRateLimits, CodexAccountUsage, CodexRateLimits, CodexRateLimitResetCredit, CodexRateLimitResetOutcome, ProviderRateLimits } from '@superone/shared/agent-types'

const FORCE_REFRESH_ON_OPEN_STALE_MS = 5 * 60 * 1000
const RATE_LIMIT_TIP_MS = 6_000
const GROK_AGENT_ID = 'grok-build'

type RateLimitTipInfo = {
  status: 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?: string
  utilization?: number
}

type GaugeHighlight = 'warning' | 'error' | null

const RESET_OUTCOME_TOAST: Record<CodexRateLimitResetOutcome, { kind: 'success' | 'info' | 'error'; key: string }> = {
  reset: { kind: 'success', key: 'usageGauge.toast.reset' },
  nothingToReset: { kind: 'info', key: 'usageGauge.toast.nothingToReset' },
  noCredit: { kind: 'info', key: 'usageGauge.toast.noCredit' },
  alreadyRedeemed: { kind: 'info', key: 'usageGauge.toast.alreadyRedeemed' },
  unknown: { kind: 'error', key: 'usageGauge.toast.unknown' },
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatWindowLabel(minutes: number | null, t: TFunction): string {
  if (!minutes || minutes <= 0) return t('usageGauge.windowFallback')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function formatResetIn(resetsAtSeconds: number | null, t: TFunction): string | null {
  if (!resetsAtSeconds) return null
  const diffMs = resetsAtSeconds * 1000 - Date.now()
  if (diffMs <= 0) return t('usageGauge.resetsSoon')
  const totalMin = Math.round(diffMs / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  let time: string
  if (days > 0) time = `${days}d ${hours}h`
  else if (hours > 0) time = `${hours}h ${mins}m`
  else time = `${mins}m`
  return t('usageGauge.resetsIn', { time })
}

function formatUpdatedAgo(fetchedAt: number, now: number, t: TFunction): string {
  const min = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (min < 1) return t('usageGauge.updatedJustNow')
  if (min < 60) return t('usageGauge.updatedMinutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('usageGauge.updatedHoursAgo', { n: hr })
  return t('usageGauge.updatedDaysAgo', { n: Math.floor(hr / 24) })
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

function remainingPercent(usedPercent: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 - usedPercent)))
}

function remainingColor(percent: number): string {
  if (percent <= 10) return 'bg-red-500'
  if (percent <= 30) return 'bg-amber-500'
  return 'bg-green-500'
}

function rateLimitTipKey(info: RateLimitTipInfo): string {
  return `${info.status}:${info.resetsAt ?? ''}:${info.rateLimitType ?? ''}:${info.utilization != null ? Math.floor(info.utilization * 20) : ''}`
}

/** Show a rate-limit tip for 6s when session rateLimitInfo changes; auto-dismiss with no residual state. */
function useRateLimitTip(info: RateLimitTipInfo | null): RateLimitTipInfo | null {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const key = info ? rateLimitTipKey(info) : null
  const visible = !!info && key !== dismissedKey

  useEffect(() => {
    if (!visible || !key) return
    const timer = window.setTimeout(() => setDismissedKey(key), RATE_LIMIT_TIP_MS)
    return () => window.clearTimeout(timer)
  }, [visible, key])

  // Dismissal is scoped to one rate-limit episode. Clearing the info ends the
  // episode, so hitting the same limit again later tips afresh instead of being
  // swallowed as a duplicate of the first hit.
  useEffect(() => {
    if (!info) setDismissedKey(null)
  }, [info])

  return visible ? info : null
}

function WindowRow({ label, usedPercent, resetsAt }: { label: string; usedPercent: number; resetsAt: number | null }) {
  const { t } = useTranslation()
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetIn = formatResetIn(resetsAt, t)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="opacity-70">{label}</span>
        <span className="flex items-center gap-1.5">
          {resetIn && <span className="opacity-50">{resetIn} ·</span>}
          <span className="font-medium tabular-nums">{t('usageGauge.percentLeft', { percent: Math.round(remaining) })}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border/60">
        <div className={cn('h-full rounded-full transition-all', remainingColor(remaining))} style={{ width: `${remaining}%` }} />
      </div>
    </div>
  )
}

function ExtraUsageRow({ extra }: { extra: ClaudeExtraUsage }) {
  const { t } = useTranslation()
  const value = extra.limitDollars != null
    ? `$${extra.usedDollars.toFixed(2)} / $${extra.limitDollars.toFixed(2)}`
    : `$${extra.usedDollars.toFixed(2)}`
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{t('usageGauge.extraUsage')}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

/** Remaining prepaid ("bought") credits — spends after the included pool is gone. */
function CreditBalanceRow({ dollars }: { dollars: number }) {
  const { t } = useTranslation()
  return <StatRow label={t('usageGauge.creditBalance')} value={`$${dollars.toFixed(2)}`} />
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function ResetCreditsRow({ count, credits, projectPath, apiProviderId, onConsumed }: { count: number; credits?: CodexRateLimitResetCredit[]; projectPath: string; apiProviderId: string | null; onConsumed: () => void }) {
  const { t } = useTranslation()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleReset = useCallback(async (creditId?: string) => {
    setBusyId(creditId ?? '__all__')
    try {
      const outcome = await window.app.codexConsumeRateLimitReset(projectPath, apiProviderId, creditId)
      const feedback = RESET_OUTCOME_TOAST[outcome ?? 'unknown']
      toast[feedback.kind](t(feedback.key))
      onConsumed()
    } catch {
      toast.error(t(RESET_OUTCOME_TOAST.unknown.key))
    } finally {
      setBusyId(null)
    }
  }, [projectPath, apiProviderId, onConsumed, t])

  const redeemable = credits?.filter((c) => c.status !== 'redeemed')
  if (redeemable && redeemable.length > 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="opacity-70">{t('usageGauge.resetCredits')}</span>
        {redeemable.map((credit) => {
          const busy = busyId === credit.id
          return (
            <div key={credit.id} className="flex items-center justify-between gap-3 pl-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{credit.title ?? t('usageGauge.resetCreditDefault')}</span>
                {credit.expiresAt != null && (
                  <span className="text-[11px] opacity-60">{t('usageGauge.resetCreditExpires', { date: formatCreditExpiry(credit.expiresAt) })}</span>
                )}
              </div>
              <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" disabled={busy || credit.status !== 'available'} onClick={() => handleReset(credit.id)}>
                {busy || credit.status === 'redeeming' ? t('usageGauge.resetting') : t('usageGauge.resetNow')}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-70">{t('usageGauge.resetCredits')}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{count}</span>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busyId !== null} onClick={() => handleReset()}>
          {busyId !== null ? t('usageGauge.resetting') : t('usageGauge.resetNow')}
        </Button>
      </div>
    </div>
  )
}

function formatCreditExpiry(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function AccountUsageSection({ usage }: { usage: CodexAccountUsage }) {
  const { t } = useTranslation()
  const rows: ReactNode[] = []
  if (usage.lifetimeTokens != null) rows.push(<StatRow key="lifetime" label={t('usageGauge.lifetimeTokens')} value={formatTokens(usage.lifetimeTokens)} />)
  if (usage.peakDailyTokens != null) rows.push(<StatRow key="peak" label={t('usageGauge.peakDaily')} value={formatTokens(usage.peakDailyTokens)} />)
  if (usage.currentStreakDays != null) rows.push(<StatRow key="streak" label={t('usageGauge.streak')} value={`${usage.currentStreakDays}d`} />)
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2">{rows}</div>
  )
}

function RateLimitTipBubble({ tip }: { tip: RateLimitTipInfo }) {
  const { t } = useTranslation()
  const isRejected = tip.status === 'rejected'
  const resetLabel = formatResetTime(tip.resetsAt)
  const pct = tip.utilization != null ? Math.round(tip.utilization * 100) : null
  const title = isRejected ? t('usageGauge.rateLimit.limited') : t('usageGauge.rateLimit.approaching')
  const details = [
    !isRejected && pct != null ? t('usageGauge.rateLimit.percentUsed', { percent: pct }) : null,
    resetLabel ? t('usageGauge.rateLimit.resetsAt', { time: resetLabel }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <PopoverContent
      role="status"
      side="top"
      align="end"
      sideOffset={8}
      collisionPadding={8}
      onOpenAutoFocus={(event) => event.preventDefault()}
      className={cn(
        'pointer-events-none w-52 rounded-md border bg-background p-2 text-xs shadow-none',
        isRejected ? 'border-error/40' : 'border-warning/40',
      )}
    >
      <div className="flex items-start gap-1.5">
        {isRejected
          ? <OctagonX className="mt-0.5 size-3.5 shrink-0 text-error" />
          : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        }
        <div className="min-w-0">
          <div className={cn('font-medium', isRejected ? 'text-error' : 'text-warning')}>{title}</div>
          {details && <div className="mt-0.5 text-[11px] text-muted-foreground">{details}</div>}
        </div>
      </div>
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-border/60">
        <motion.div
          key={rateLimitTipKey(tip)}
          className={cn('h-full origin-left', isRejected ? 'bg-error' : 'bg-warning')}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: RATE_LIMIT_TIP_MS / 1000, ease: 'linear' }}
        />
      </div>
    </PopoverContent>
  )
}

function RateLimitTipHost({ tip, children }: { tip: RateLimitTipInfo | null; children: ReactNode }) {
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

function RateLimitGauge({ title, planType, badgeRemaining, onOpen, onRefresh, refreshing, fetchedAt, highlight, children }: {
  title: string
  planType: string | null
  badgeRemaining: number | null
  onOpen?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  fetchedAt?: number | null
  highlight?: GaugeHighlight
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open || fetchedAt == null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open, fetchedAt])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (next) onOpen?.()
  }, [onOpen])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          className={cn(
            'transition-colors',
            badgeRemaining != null && 'h-6 w-auto gap-1 px-1.5',
            highlight === 'warning' && 'border border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning',
            highlight === 'error' && 'border border-error/40 bg-error/10 text-error hover:bg-error/15 hover:text-error',
          )}
        >
          <Gauge />
          {badgeRemaining != null && (
            <span className="text-[11px] font-medium tabular-nums">{badgeRemaining}%</span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-3">
        <div className="flex min-w-52 flex-col gap-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{title}</span>
            {planType && <span className="opacity-50">{planType}</span>}
          </div>
          {children}
          {(onRefresh || refreshing || fetchedAt != null) && (
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
              <span className="text-[10px] tabular-nums opacity-50">
                {refreshing ? t('usageGauge.updating') : fetchedAt != null ? formatUpdatedAgo(fetchedAt, now, t) : ''}
              </span>
              {onRefresh && (
                <IconButton size="xs" variant="ghost" disabled={refreshing} onClick={onRefresh}>
                  <RefreshCw className={cn(refreshing && 'animate-spin')} />
                </IconButton>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function useRefetchOnTurnEnd(status: string, fetchLimits: () => void) {
  const prevStatusRef = useRef(status)
  useEffect(() => {
    fetchLimits()
  }, [fetchLimits])
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    prevStatusRef.current = status
    if (wasStreaming && status === 'idle') fetchLimits()
  }, [status, fetchLimits])
}

function CodexRateLimitIcon({ projectPath, apiProviderId, status, tip, highlight }: { projectPath: string; apiProviderId: string | null; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const [usage, setUsage] = useState<CodexAccountUsage | null>(null)

  const fetchLimits = useCallback(() => {
    window.app.codexGetRateLimits(projectPath, apiProviderId).then(setLimits).catch(() => {})
    window.app.codexGetAccountUsage(projectPath, apiProviderId).then(setUsage).catch(() => {})
  }, [projectPath, apiProviderId])

  useEffect(() => {
    setLimits(null)
    setUsage(null)
  }, [projectPath, apiProviderId])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || (!limits.primary && !limits.secondary)) {
    return (
      <RateLimitTipHost tip={tip}>
        {highlight ? <FallbackRateLimitGauge highlight={highlight} /> : null}
      </RateLimitTipHost>
    )
  }

  const badgeWindow = limits.primary ?? limits.secondary
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge title={t('usageGauge.codexTitle')} planType={limits.planType} badgeRemaining={badgeRemaining} onOpen={fetchLimits} highlight={highlight}>
        {limits.primary && (
          <WindowRow label={formatWindowLabel(limits.primary.windowDurationMins, t)} usedPercent={limits.primary.usedPercent} resetsAt={limits.primary.resetsAt} />
        )}
        {limits.secondary && (
          <WindowRow label={formatWindowLabel(limits.secondary.windowDurationMins, t)} usedPercent={limits.secondary.usedPercent} resetsAt={limits.secondary.resetsAt} />
        )}
        {limits.resetCredits != null && limits.resetCredits > 0 && (
          <ResetCreditsRow count={limits.resetCredits} credits={limits.resetCreditList} projectPath={projectPath} apiProviderId={apiProviderId} onConsumed={fetchLimits} />
        )}
        {usage && <AccountUsageSection usage={usage} />}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function ClaudeRateLimitIcon({ status, tip, highlight }: { status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const { t } = useTranslation()
  const [limits, setLimits] = useState<ClaudeRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLimits = useCallback(() => {
    window.app.claudeGetRateLimits().then(setLimits).catch(() => {})
  }, [])

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.app
      .claudeGetRateLimits(true)
      .then(setLimits)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || limits.windows.length === 0) {
    return (
      <RateLimitTipHost tip={tip}>
        {highlight ? <FallbackRateLimitGauge highlight={highlight} /> : null}
      </RateLimitTipHost>
    )
  }

  const badgeWindow = limits.windows.find((w) => w.label === '5h') ?? limits.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge title={t('usageGauge.claudeTitle')} planType={limits.planType} badgeRemaining={badgeRemaining} onOpen={refreshIfStale} onRefresh={refresh} refreshing={refreshing} fetchedAt={limits.fetchedAt} highlight={highlight}>
        {limits.windows.map((w) => (
          <WindowRow key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
        ))}
        {limits.extraUsage && <ExtraUsageRow extra={limits.extraUsage} />}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function ProviderRateLimitIcon({ apiProviderId, status, tip, highlight }: { apiProviderId: string; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const [limits, setLimits] = useState<ProviderRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLimits = useCallback(() => {
    window.app.providerGetRateLimits(apiProviderId).then(setLimits).catch(() => {})
  }, [apiProviderId])

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.app
      .providerGetRateLimits(apiProviderId, true)
      .then(setLimits)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [apiProviderId])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useEffect(() => {
    setLimits(null)
  }, [apiProviderId])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || limits.windows.length === 0) {
    return (
      <RateLimitTipHost tip={tip}>
        {highlight ? <FallbackRateLimitGauge highlight={highlight} /> : null}
      </RateLimitTipHost>
    )
  }

  const badgeWindow = limits.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge title={limits.title} planType={limits.planType} badgeRemaining={badgeRemaining} onOpen={refreshIfStale} onRefresh={refresh} refreshing={refreshing} fetchedAt={limits.fetchedAt} highlight={highlight}>
        {limits.windows.map((w) => (
          <WindowRow key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
        ))}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

/**
 * Grok Build credits, read from the live ACP runtime via `_x.ai/billing`.
 * Only Grok exposes a billing surface, so other ACP agents keep the bare tip.
 */
function AcpRateLimitIcon({ projectPath, agentId, status, tip, highlight }: { projectPath: string; agentId: string; status: string; tip: RateLimitTipInfo | null; highlight: GaugeHighlight }) {
  const [limits, setLimits] = useState<ProviderRateLimits | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchLimits = useCallback(() => {
    window.app.acpGetRateLimits(projectPath, agentId).then(setLimits).catch(() => {})
  }, [projectPath, agentId])

  const refresh = useCallback(() => {
    setRefreshing(true)
    window.app
      .acpGetRateLimits(projectPath, agentId, true)
      .then(setLimits)
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }, [projectPath, agentId])

  const refreshIfStale = useCallback(() => {
    const fetchedAt = limits?.fetchedAt
    if (fetchedAt == null || Date.now() - fetchedAt > FORCE_REFRESH_ON_OPEN_STALE_MS) refresh()
  }, [limits?.fetchedAt, refresh])

  useEffect(() => {
    setLimits(null)
  }, [projectPath, agentId])

  useRefetchOnTurnEnd(status, fetchLimits)

  if (!limits || limits.windows.length === 0) {
    return (
      <RateLimitTipHost tip={tip}>
        {highlight ? <FallbackRateLimitGauge highlight={highlight} /> : null}
      </RateLimitTipHost>
    )
  }

  const badgeWindow = limits.windows[0]
  const badgeRemaining = badgeWindow ? remainingPercent(badgeWindow.usedPercent) : null

  return (
    <RateLimitTipHost tip={tip}>
      <RateLimitGauge title={limits.title} planType={limits.planType} badgeRemaining={badgeRemaining} onOpen={refreshIfStale} onRefresh={refresh} refreshing={refreshing} fetchedAt={limits.fetchedAt} highlight={highlight}>
        {limits.windows.map((w) => (
          <WindowRow key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
        ))}
        {limits.extraUsage && <ExtraUsageRow extra={limits.extraUsage} />}
        {limits.creditBalanceDollars != null && (
          <CreditBalanceRow dollars={limits.creditBalanceDollars} />
        )}
      </RateLimitGauge>
    </RateLimitTipHost>
  )
}

function FallbackRateLimitGauge({ highlight }: { highlight: GaugeHighlight }) {
  return (
    <IconButton
      size="sm"
      className={cn(
        'transition-colors',
        highlight === 'warning' && 'border border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning',
        highlight === 'error' && 'border border-error/40 bg-error/10 text-error hover:bg-error/15 hover:text-error',
      )}
    >
      <Gauge />
    </IconButton>
  )
}

export function UsageStatusIcon() {
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const apiProviderId = useActiveSession((s) => s.apiProviderId)
  const acpAgentId = useActiveSession((s) => s.acpAgentId)
  const status = useActiveSession((s) => s.status)
  const rateLimitInfo = useActiveSession((s) => s.rateLimitInfo)
  const claudeApiProvider = useChatStore((s) => s.harnessResources.claude?.account?.apiProvider)
  const activeProvider = sessionProvider ?? preferredProvider

  const tip = useRateLimitTip(rateLimitInfo)
  const highlight: GaugeHighlight = tip
    ? (tip.status === 'rejected' ? 'error' : 'warning')
    : null

  if (!activeProject) return null

  if (activeProvider === 'codex') {
    return <CodexRateLimitIcon projectPath={activeProject} apiProviderId={apiProviderId ?? null} status={status} tip={tip} highlight={highlight} />
  }

  if (activeProvider === 'claude' && claudeApiProvider === 'firstParty' && !apiProviderId) {
    return <ClaudeRateLimitIcon status={status} tip={tip} highlight={highlight} />
  }

  if (activeProvider === 'claude' && apiProviderId) {
    return <ProviderRateLimitIcon apiProviderId={apiProviderId} status={status} tip={tip} highlight={highlight} />
  }

  // Grok is the only ACP agent with a billing surface; asking the others would
  // just be a round-trip to `method not found` on every turn end.
  if (activeProvider === 'acp' && acpAgentId === GROK_AGENT_ID) {
    return <AcpRateLimitIcon projectPath={activeProject} agentId={acpAgentId} status={status} tip={tip} highlight={highlight} />
  }

  if (tip) {
    return (
      <RateLimitTipHost tip={tip}>
        <FallbackRateLimitGauge highlight={highlight} />
      </RateLimitTipHost>
    )
  }

  return null
}
