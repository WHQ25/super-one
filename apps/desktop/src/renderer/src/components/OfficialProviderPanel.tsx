import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@superone/ui/lib/utils'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useChatStore } from '@/stores/chat'
import type { ClaudeRateLimits, CodexAccountUsage, CodexAuthStatus, CodexRateLimits } from '@superone/shared/agent-types'
import { ProviderLabel } from './ProviderLabel'

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
  const time = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return t('usageGauge.resetsIn', { time })
}

function remainingColor(percent: number): string {
  if (percent <= 10) return 'bg-red-500'
  if (percent <= 30) return 'bg-amber-500'
  return 'bg-green-500'
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium tabular-nums">{value}</span>
    </div>
  )
}

function WindowBar({ label, usedPercent, resetsAt }: { label: string; usedPercent: number; resetsAt: number | null }) {
  const { t } = useTranslation()
  const remaining = Math.max(0, Math.min(100, 100 - usedPercent))
  const resetIn = formatResetIn(resetsAt, t)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
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

function PanelShell({ presetKey, children, onRefresh, refreshing }: { presetKey: string; children: ReactNode; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <ProviderLabel presetKey={presetKey} combine size={30} />
        <IconButton size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </IconButton>
      </div>
      {children}
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-md border border-border p-3">{children}</div>
}

function ClaudeAccount() {
  const { t } = useTranslation()
  const account = useChatStore((s) => s.harnessResources.claude?.account)
  const [limits, setLimits] = useState<ClaudeRateLimits | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchLimits = useCallback((force?: boolean) => {
    setLoading(true)
    window.app.claudeGetRateLimits(force).then(setLimits).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchLimits() }, [fetchLimits])

  const plan = account?.subscriptionType || limits?.planType

  return (
    <PanelShell presetKey="default-claude" onRefresh={() => fetchLimits(true)} refreshing={loading}>
      <Section>
        {plan ? <InfoRow label={t('resources.providers.accountPlan')} value={plan} /> : null}
        {account?.email ? <InfoRow label={t('resources.providers.accountEmail')} value={account.email} /> : null}
        {account?.organization ? <InfoRow label={t('resources.providers.accountOrg')} value={account.organization} /> : null}
        {!plan && !account?.email && (
          <span className="text-sm text-muted-foreground">{loading ? t('resources.providers.accountLoading') : t('resources.providers.accountNotSignedIn')}</span>
        )}
      </Section>
      {limits && limits.windows.length > 0 && (
        <Section>
          {limits.windows.map((w) => (
            <WindowBar key={w.label} label={w.label} usedPercent={w.usedPercent} resetsAt={w.resetsAt} />
          ))}
          {limits.extraUsage && (
            <InfoRow
              label={t('usageGauge.extraUsage')}
              value={limits.extraUsage.limitDollars != null ? `$${limits.extraUsage.usedDollars.toFixed(2)} / $${limits.extraUsage.limitDollars.toFixed(2)}` : `$${limits.extraUsage.usedDollars.toFixed(2)}`}
            />
          )}
        </Section>
      )}
    </PanelShell>
  )
}

function CodexAccount() {
  const { t } = useTranslation()
  const projectPath = useChatStore((s) => s.activeProject)
  const [auth, setAuth] = useState<CodexAuthStatus | null>(null)
  const [limits, setLimits] = useState<CodexRateLimits | null>(null)
  const [usage, setUsage] = useState<CodexAccountUsage | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(() => {
    if (!projectPath) return
    setLoading(true)
    Promise.allSettled([
      window.app.codexGetAuthStatus(projectPath).then(setAuth),
      window.app.codexGetRateLimits(projectPath, null).then(setLimits),
      window.app.codexGetAccountUsage(projectPath, null).then(setUsage),
    ]).finally(() => setLoading(false))
  }, [projectPath])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (!projectPath) {
    return (
      <PanelShell presetKey="default-codex" onRefresh={fetchAll} refreshing={false}>
        <span className="text-sm text-muted-foreground">{t('resources.providers.codexNeedsProject')}</span>
      </PanelShell>
    )
  }

  return (
    <PanelShell presetKey="default-codex" onRefresh={fetchAll} refreshing={loading}>
      <Section>
        {auth ? <InfoRow label={t('resources.providers.accountSignIn')} value={auth.resolvedMode === 'chatgpt' ? 'ChatGPT' : 'API Key'} /> : null}
        {limits?.planType ? <InfoRow label={t('resources.providers.accountPlan')} value={limits.planType} /> : null}
        {!auth && !limits?.planType && (
          <span className="text-sm text-muted-foreground">{loading ? t('resources.providers.accountLoading') : t('resources.providers.accountNotSignedIn')}</span>
        )}
      </Section>
      {limits && (limits.primary || limits.secondary) && (
        <Section>
          {limits.primary && <WindowBar label={formatWindowLabel(limits.primary.windowDurationMins, t)} usedPercent={limits.primary.usedPercent} resetsAt={limits.primary.resetsAt} />}
          {limits.secondary && <WindowBar label={formatWindowLabel(limits.secondary.windowDurationMins, t)} usedPercent={limits.secondary.usedPercent} resetsAt={limits.secondary.resetsAt} />}
        </Section>
      )}
      {usage && (usage.lifetimeTokens != null || usage.peakDailyTokens != null || usage.currentStreakDays != null) && (
        <Section>
          {usage.lifetimeTokens != null && <InfoRow label={t('usageGauge.lifetimeTokens')} value={formatTokens(usage.lifetimeTokens)} />}
          {usage.peakDailyTokens != null && <InfoRow label={t('usageGauge.peakDaily')} value={formatTokens(usage.peakDailyTokens)} />}
          {usage.currentStreakDays != null && <InfoRow label={t('usageGauge.streak')} value={`${usage.currentStreakDays}d`} />}
        </Section>
      )}
      {loading && !auth && !limits && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> {t('resources.providers.accountLoading')}</div>
      )}
    </PanelShell>
  )
}

export function OfficialProviderPanel({ harness }: { harness: 'claude' | 'codex' }) {
  return harness === 'claude' ? <ClaudeAccount /> : <CodexAccount />
}
