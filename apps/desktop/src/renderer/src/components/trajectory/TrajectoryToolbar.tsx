import { useTranslation } from 'react-i18next'
import { FoldVertical, RefreshCw, Search, UnfoldVertical } from 'lucide-react'
import { Input } from '@superone/ui/components/ui/input'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { formatTokens } from './trajectory-format'

export interface TrajectoryToolbarProps {
  projection: TrajectoryProjection
  query: string
  onQueryChange: (query: string) => void
  turnsFolded: boolean
  callsFolded: boolean
  onToggleAllTurns: () => void
  onToggleAllCalls: () => void
  onRefresh: () => void
  refreshing: boolean
}

/** Search, folding, and the window's cumulative accounting. */
export function TrajectoryToolbar({
  projection,
  query,
  onQueryChange,
  turnsFolded,
  callsFolded,
  onToggleAllTurns,
  onToggleAllCalls,
  onRefresh,
  refreshing,
}: TrajectoryToolbarProps) {
  const { t } = useTranslation()
  const { totals } = projection

  return (
    <div
      role="toolbar"
      aria-label={t('trajectory.toolbarAria')}
      className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5"
    >
      <div className="relative w-56">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('trajectory.searchPlaceholder')}
          aria-label={t('trajectory.search')}
          className="h-7 pl-7 text-xs"
        />
      </div>

      <IconButton
        size="sm"
        tooltip={t(turnsFolded ? 'trajectory.expandTurns' : 'trajectory.collapseTurns')}
        onClick={onToggleAllTurns}
      >
        {turnsFolded ? <UnfoldVertical /> : <FoldVertical />}
      </IconButton>
      <IconButton
        size="sm"
        tooltip={t(callsFolded ? 'trajectory.expandCalls' : 'trajectory.collapseCalls')}
        onClick={onToggleAllCalls}
      >
        {callsFolded ? <UnfoldVertical /> : <FoldVertical />}
      </IconButton>

      <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
        <span>{t('trajectory.requestCount', { count: projection.requests.length })}</span>
        <span>
          {t('trajectory.tokenTotals', {
            input: formatTokens(totals.input),
            output: formatTokens(totals.output),
          })}
        </span>
      </div>

      <IconButton
        size="sm"
        tooltip={t('trajectory.refresh')}
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
      </IconButton>
    </div>
  )
}
