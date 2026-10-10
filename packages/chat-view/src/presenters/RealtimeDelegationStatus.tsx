import { ChevronRight, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RealtimeTurnActivity } from '@superone/shared/realtime-turn-activities'
import { formatCompactDuration } from './duration-format'
import { useWorkingDuration } from '../use-working-duration'

/** Shared desktop/mobile stand-in for work delegated by a spoken turn. */
export function RealtimeDelegationStatus({ activity, onOpen }: {
  activity: RealtimeTurnActivity
  onOpen: () => void
}) {
  const { t, i18n } = useTranslation()
  const elapsed = useWorkingDuration(activity.status === 'working' ? activity.workingSince : null)
  const label = activity.status === 'working'
    ? t('chat.compactMode.workingFor', { duration: formatCompactDuration(elapsed, i18n.resolvedLanguage ?? i18n.language) })
    : t('chat.compactMode.detail')
  return <button type="button" onClick={onOpen} aria-label={t('chat.realtimeVoice.delegation.openThread')}
    className="group flex w-full items-center gap-1.5 border-b border-border/50 py-1 text-left text-xs text-muted-foreground/80 transition-colors hover:text-muted-foreground">
    <List className="size-3 shrink-0 opacity-70" />
    <span data-testid="realtime-delegation-status" className="min-w-0 truncate font-normal tracking-wide tabular-nums">{label}</span>
    <ChevronRight className="ml-auto size-3 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
  </button>
}
