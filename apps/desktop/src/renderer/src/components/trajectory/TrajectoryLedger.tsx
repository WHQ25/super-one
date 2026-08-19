import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { TrajectoryRow } from './TrajectoryRow'
import { buildLedgerRows, stepKey, type LedgerRow } from './trajectory-rows'
import { formatDuration } from './trajectory-format'

/** Row height estimate; every row in this ledger is a single line. */
const ROW_HEIGHT = 26

export interface TrajectoryLedgerProps {
  projection: TrajectoryProjection
  query: string
  foldedTurns: ReadonlySet<number>
  foldedSteps: ReadonlySet<string>
  selectedId: string | null
  onSelect: (recordId: string) => void
  onToggleTurn: (turn: number) => void
  onToggleStep: (step: string) => void
}

/** The turn-aware event ledger: one line per record, virtualized. */
export function TrajectoryLedger({
  projection,
  query,
  foldedTurns,
  foldedSteps,
  selectedId,
  onSelect,
  onToggleTurn,
  onToggleStep,
}: TrajectoryLedgerProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => buildLedgerRows({ projection, query, foldedTurns, foldedSteps }),
    [projection, query, foldedTurns, foldedSteps],
  )

  /**
   * The steps that actually made tool calls. A message in a step with no calls
   * gets no fold handle, because folding it would hide nothing.
   */
  const stepsWithCalls = useMemo(() => {
    const steps = new Set<string>()
    for (const record of projection.records) {
      if (record.kind === 'tool') steps.add(stepKey(record.turn, record.step))
    }
    return steps
  }, [projection])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    // Semantic keys, so folding and filtering do not remount unrelated rows.
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  const renderRow = useCallback((row: LedgerRow) => {
    if (row.kind === 'between') {
      return (
        <div className="flex items-center gap-2 border-t border-border px-4 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.betweenTurns')}
          </span>
        </div>
      )
    }

    if (row.kind === 'turn') {
      const { turn } = row
      return (
        <div className="flex items-center gap-2 border-t-2 border-border bg-muted/30 px-2 py-1.5">
          <IconButton
            size="xs"
            variant="nested"
            tooltip={t(row.folded ? 'trajectory.expandTurns' : 'trajectory.collapseTurns')}
            onClick={() => onToggleTurn(turn.turn)}
          >
            {row.folded ? <ChevronRight /> : <ChevronDown />}
          </IconButton>
          <span className="font-mono text-[11px] font-medium">
            {t('trajectory.turn', { turn: turn.turn })}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/70">
            {t('trajectory.turnCounts', { steps: turn.steps, calls: turn.toolCalls })}
          </span>
          {turn.outcome !== null && turn.outcome !== 'completed' && (
            <span className="font-mono text-[10px] text-muted-foreground">{turn.outcome}</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
            {formatDuration(turn.durationMs)}
          </span>
        </div>
      )
    }

    const { record } = row
    const step = stepKey(record.turn, record.step)
    return (
      <TrajectoryRow
        record={record}
        selected={record.id === selectedId}
        foldedCalls={foldedSteps.has(step)}
        onToggleCalls={record.kind === 'message' && stepsWithCalls.has(step)
          ? () => onToggleStep(step)
          : undefined}
        onSelect={() => onSelect(record.id)}
      />
    )
  }, [t, foldedSteps, selectedId, stepsWithCalls, onSelect, onToggleStep, onToggleTurn])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden">
      {projection.dropped > 0 && (
        <div className="border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          {t('trajectory.droppedPrefix', { count: projection.dropped })}
        </div>
      )}
      {rows.length === 0
        ? <div className="px-4 py-6 text-[11px] text-muted-foreground">{t('trajectory.noMatches')}</div>
        : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={cn('w-full')}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
                >
                  {renderRow(row)}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
