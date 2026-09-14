import { useTranslation } from 'react-i18next'
import type { CodexAccountUsage, CodexRateLimits } from '@superone/shared/agent-types'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { InfoRow, WindowBar, formatTokens, formatWindowLabel } from './provider-usage'

export interface CodexAccountMeters {
  loading?: boolean
  limits?: CodexRateLimits | null
  usage?: CodexAccountUsage | null
  error?: boolean
}

export function CodexAccountMeters({ loading, limits, usage, error }: CodexAccountMeters) {
  const { t } = useTranslation()
  if (loading) return <div aria-label={t('usageGauge.updating')} className="flex flex-col gap-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
  return <div className="flex flex-col gap-3">
    {limits?.primary && <WindowBar label={formatWindowLabel(limits.primary.windowDurationMins, t)} usedPercent={limits.primary.usedPercent} resetsAt={limits.primary.resetsAt} />}
    {limits?.secondary && <WindowBar label={formatWindowLabel(limits.secondary.windowDurationMins, t)} usedPercent={limits.secondary.usedPercent} resetsAt={limits.secondary.resetsAt} />}
    {usage && <div className="flex flex-col gap-1.5">
      {usage.lifetimeTokens != null && <InfoRow label={t('usageGauge.lifetimeTokens')} value={formatTokens(usage.lifetimeTokens)} />}
      {usage.peakDailyTokens != null && <InfoRow label={t('usageGauge.peakDaily')} value={formatTokens(usage.peakDailyTokens)} />}
      {usage.currentStreakDays != null && <InfoRow label={t('usageGauge.streak')} value={`${usage.currentStreakDays}d`} />}
    </div>}
    {(error || (!limits && !usage)) && <p className="text-xs text-muted-foreground" role="status">{t('settings.harnesses.codexAccount.usageUnavailable')}</p>}
  </div>
}
