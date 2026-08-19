import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { TrajectoryRow } from './TrajectoryRow'
import { buildLedgerRows, stepKey, type LedgerRow } from './trajectory-rows'
import type { TrajectorySelection } from './trajectory-selection'
import { formatDuration, formatTokens } from './trajectory-format'

/** Row height estimate; every row in this ledger is a single line. */
const ROW_HEIGHT = 26

/** How close to the bottom counts as following the tail. */
const FOLLOW_SLACK_PX = 8

export interface TrajectoryLedgerProps {
  projection: TrajectoryProjection
  query: string
  /** Record ids the timeline selection admits, or `null` when unfiltered. */
  visibleIds: ReadonlySet<string> | null
  foldedTurns: ReadonlySet<number>
  foldedSteps: ReadonlySet<string>
  selection: TrajectorySelection
  onSelect: (selection: TrajectorySelection) => void
  onToggleTurn: (turn: number) => void
  onToggleStep: (step: string) => void
  onLoadEarlier: () => void
  paging: boolean
  /**
   * The record to bring into view, e.g. after a timeline click, with the nonce
   * that makes it a one-shot request. Without it, every appended record during
   * a live turn would drag the ledger back to the same row.
   */
  reveal: { id: string; nonce: number } | null
}

/** The turn-aware event ledger: one line per record, virtualized. */
export function TrajectoryLedger({
  projection,
  query,
  visibleIds,
  foldedTurns,
  foldedSteps,
  selection,
  onSelect,
  onToggleTurn,
  onToggleStep,
  onLoadEarlier,
  paging,
  reveal,
}: TrajectoryLedgerProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => buildLedgerRows({ projection, query, visibleIds, foldedTurns, foldedSteps }),
    [projection, query, visibleIds, foldedTurns, foldedSteps],
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
    // Semantic keys, so folding, filtering, and paging do not remount unrelated
    // rows — and so the tail keeps its measurements while a turn streams.
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  // Follow the tail only while the user is already at it. Scrolling up is how a
  // user says "I am reading this", and a live turn must not yank them back.
  const followingRef = useRef(true)
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === null) return
    followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK_PX
  }, [])

  useEffect(() => {
    if (!followingRef.current || rows.length === 0) return
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
  }, [rows.length, virtualizer])

  // Hold the visual position when an earlier page arrives: the rows a user is
  // reading must not slide down by the height of history they just requested.
  const firstIndexRef = useRef(projection.firstIndex)
  const totalSizeRef = useRef(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const total = virtualizer.getTotalSize()
    if (el !== null && projection.firstIndex < firstIndexRef.current) {
      el.scrollTop += total - totalSizeRef.current
    }
    firstIndexRef.current = projection.firstIndex
    totalSizeRef.current = total
  })

  // A record revealed from the timeline may be anywhere in the window. The
  // effect keys on the nonce so it runs once per request; `rows` is read, not
  // depended on, because a streaming append must not re-scroll.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useEffect(() => {
    if (reveal === null) return
    const index = rowsRef.current.findIndex((row) => row.kind === 'record' && row.record.id === reveal.id)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'center' })
  }, [reveal?.id, reveal?.nonce, virtualizer])

  const renderRow = useCallback((row: LedgerRow) => {
    if (row.kind === 'earlier') {
      return (
        <button
          type="button"
          onClick={onLoadEarlier}
          disabled={paging}
          className={cn(
            'flex w-full items-center gap-2 border-b border-border px-4 py-1.5',
            'text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60',
          )}
        >
          {paging
            ? <Loader2 className="size-3 animate-spin" />
            : <MoreHorizontal className="size-3" />}
          {t('trajectory.loadEarlier')}
        </button>
      )
    }

    if (row.kind === 'between') {
      return (
        <div className="flex items-center gap-2 px-4 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t('trajectory.betweenTurns')}
          </span>
        </div>
      )
    }

    if (row.kind === 'turn') {
      const { turn } = row
      return (
        <div className="flex items-center gap-2 bg-muted/30 px-2 py-1.5">
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

    if (row.kind === 'request') {
      const { request } = row
      const selected = selection?.kind === 'request' && selection.ordinal === request.ordinal
      return (
        <button
          type="button"
          onClick={() => onSelect({ kind: 'request', ordinal: request.ordinal })}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1 text-left font-mono text-[10px]',
            'text-muted-foreground/80 hover:text-foreground',
            selected && 'bg-accent text-foreground',
          )}
        >
          <span className="w-10 shrink-0 text-right">
            <span className="inline-block size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
          </span>
          <span>{t('trajectory.request', { ordinal: request.ordinal })}</span>
          <span className="text-muted-foreground/60">{request.purpose}</span>
          {request.route !== null && <span className="truncate">{request.route.model}</span>}
          <span className="ml-auto shrink-0">
            {request.usage === null
              ? '—'
              : t('trajectory.tokenTotals', {
                input: formatTokens(request.usage.input),
                output: formatTokens(request.usage.output),
              })}
          </span>
          <span className="w-14 shrink-0 text-right">{formatDuration(request.durationMs)}</span>
        </button>
      )
    }

    const { record } = row
    const step = stepKey(record.turn, record.step)
    return (
      <TrajectoryRow
        record={record}
        selected={selection?.kind === 'record' && selection.id === record.id}
        foldedCalls={foldedSteps.has(step)}
        onToggleCalls={record.kind === 'message' && stepsWithCalls.has(step)
          ? () => onToggleStep(step)
          : undefined}
        onSelect={() => onSelect({ kind: 'record', id: record.id })}
      />
    )
  }, [
    t, foldedSteps, selection, stepsWithCalls, onSelect, onToggleStep, onToggleTurn,
    onLoadEarlier, paging,
  ])

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overflow-x-hidden">
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
                  className="w-full"
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
