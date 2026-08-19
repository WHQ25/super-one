import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, Route } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { TrajectoryInspector } from './TrajectoryInspector'
import { TrajectoryRequestInspector } from './TrajectoryRequestInspector'
import { TrajectoryNotice } from './TrajectoryNotice'
import { TrajectoryLedger } from './TrajectoryLedger'
import { TrajectoryTimeline } from './TrajectoryTimeline'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { foldableSteps } from './trajectory-rows'
import type { TrajectorySelection } from './trajectory-selection'
import { exportTrajectoryJson, exportTrajectoryMarkdown } from './trajectory-export'
import {
  buildSegments,
  buildTimeline,
  idsInRange,
  type TimelineRange,
  type TimelineSegmentation,
} from './trajectory-timeline'
import { useTrajectory } from './use-trajectory'

/** The loading notice's icon slot, spinning in place. */
function SpinningLoader({ className }: { className?: string }) {
  return <Loader2 className={`${className ?? ''} animate-spin`} />
}

function RetryButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  )
}

export interface TrajectoryPanelProps {
  sessionId: string
}

/** The Trajectory view: a turn-aware event ledger over one dsh session log. */
export function TrajectoryPanel({ sessionId }: TrajectoryPanelProps) {
  const { t } = useTranslation()
  const { load, refreshing, paging, refresh, loadEarlier } = useTrajectory(sessionId)

  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<TrajectorySelection>(null)
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null)
  const [foldedTurns, setFoldedTurns] = useState<ReadonlySet<number>>(new Set())
  const [foldedSteps, setFoldedSteps] = useState<ReadonlySet<string>>(new Set())
  const [timelineShown, setTimelineShown] = useState(true)
  const [range, setRange] = useState<TimelineRange | null>(null)
  const [segmentation, setSegmentation] = useState<TimelineSegmentation>('time')
  const [viewport, setViewport] = useState<TimelineRange | null>(null)

  const projection = load.status === 'ready' ? load.projection : null

  useEffect(() => {
    setSelection(null)
    setRange(null)
    setViewport(null)
  }, [sessionId])

  const timeline = useMemo(() => (projection === null ? null : buildTimeline(projection)), [projection])

  // The viewport follows the domain until the user zooms. Snapping it back on
  // every append would fight a user who has zoomed in on a slow turn; the reset
  // above returns it to following when the session changes.
  const domain: TimelineRange | null = timeline === null ? null : { start: timeline.start, end: timeline.end }
  const activeViewport = viewport ?? domain

  const segments = useMemo(
    () => (projection === null || timeline === null
      ? []
      : buildSegments(projection, segmentation, timeline)),
    [projection, segmentation, timeline],
  )

  const visibleIds = useMemo(
    () => (timeline === null ? null : idsInRange(timeline, range)),
    [timeline, range],
  )

  const selectedRecord = useMemo(
    () => (projection === null || selection?.kind !== 'record'
      ? null
      : projection.records.find((record) => record.id === selection.id) ?? null),
    [projection, selection],
  )
  const selectedRequest = useMemo(
    () => (projection === null || selection?.kind !== 'request'
      ? null
      : projection.requests[selection.ordinal - 1] ?? null),
    [projection, selection],
  )

  const allTurns = useMemo(() => projection?.turns.map((turn) => turn.turn) ?? [], [projection])
  const allSteps = useMemo(() => (projection === null ? [] : foldableSteps(projection)), [projection])
  const turnsFolded = allTurns.length > 0 && foldedTurns.size === allTurns.length
  const callsFolded = allSteps.length > 0 && foldedSteps.size === allSteps.length

  const toggleTurn = useCallback((turn: number) => {
    setFoldedTurns((current) => {
      const next = new Set(current)
      if (!next.delete(turn)) next.add(turn)
      return next
    })
  }, [])

  const toggleStep = useCallback((step: string) => {
    setFoldedSteps((current) => {
      const next = new Set(current)
      if (!next.delete(step)) next.add(step)
      return next
    })
  }, [])

  const select = useCallback((next: TrajectorySelection) => {
    setSelection(next)
    setReveal(null)
  }, [])

  const revealRecord = useCallback((recordId: string) => {
    setSelection({ kind: 'record', id: recordId })
    // The nonce makes a repeat of the same record a fresh scroll request, and
    // keeps an unrelated re-render from replaying the last one.
    setReveal((current) => ({ id: recordId, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  const onExport = useCallback((format: 'json' | 'markdown') => {
    if (projection === null) return
    const text = format === 'json'
      ? exportTrajectoryJson(projection)
      : exportTrajectoryMarkdown(projection)
    const extension = format === 'json' ? 'json' : 'md'
    void window.app.saveTextAs(text, `trajectory-${projection.sessionId}.${extension}`)
  }, [projection])

  if (load.status === 'loading') {
    return (
      <TrajectoryNotice
        icon={SpinningLoader}
        title={t('trajectory.notice.loadingTitle')}
        detail={t('trajectory.notice.loadingDetail')}
      />
    )
  }
  if (load.status === 'absent') {
    return (
      <TrajectoryNotice
        icon={Route}
        title={t('trajectory.notice.absentTitle')}
        detail={t('trajectory.notice.absentDetail')}
        action={<RetryButton onClick={refresh} disabled={refreshing} label={t('trajectory.notice.retry')} />}
      />
    )
  }
  if (load.status === 'failed') {
    return (
      <TrajectoryNotice
        failed
        icon={AlertTriangle}
        title={t('trajectory.notice.errorTitle')}
        detail={t('trajectory.notice.errorDetail')}
        diagnostic={load.error}
        action={<RetryButton onClick={refresh} disabled={refreshing} label={t('trajectory.notice.retry')} />}
      />
    )
  }
  if (load.projection.records.length === 0) {
    return (
      <TrajectoryNotice
        icon={Route}
        title={t('trajectory.notice.emptyTitle')}
        detail={t('trajectory.notice.emptyDetail')}
        action={<RetryButton onClick={refresh} disabled={refreshing} label={t('trajectory.notice.retry')} />}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TrajectoryToolbar
        projection={load.projection}
        query={query}
        onQueryChange={setQuery}
        turnsFolded={turnsFolded}
        callsFolded={callsFolded}
        onToggleAllTurns={() => setFoldedTurns(turnsFolded ? new Set() : new Set(allTurns))}
        onToggleAllCalls={() => setFoldedSteps(callsFolded ? new Set() : new Set(allSteps))}
        timelineShown={timelineShown}
        onToggleTimeline={() => setTimelineShown((shown) => !shown)}
        filtered={range !== null}
        onClearFilter={() => setRange(null)}
        onExport={onExport}
        onRefresh={refresh}
        refreshing={refreshing}
      />

      {timelineShown && timeline !== null && activeViewport !== null && (
        <TrajectoryTimeline
          model={timeline}
          viewport={activeViewport}
          onViewportChange={setViewport}
          range={range}
          onRangeChange={setRange}
          segmentation={segmentation}
          onSegmentationChange={setSegmentation}
          segments={segments}
          canLoadEarlier={load.projection.firstIndex > 1}
          onLoadEarlier={loadEarlier}
          paging={paging}
          selectedId={selection?.kind === 'record' ? selection.id : null}
          onSelect={revealRecord}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <TrajectoryLedger
            projection={load.projection}
            query={query}
            visibleIds={visibleIds}
            foldedTurns={foldedTurns}
            foldedSteps={foldedSteps}
            selection={selection}
            onSelect={select}
            onToggleTurn={toggleTurn}
            onToggleStep={toggleStep}
            onLoadEarlier={loadEarlier}
            paging={paging}
            reveal={reveal}
          />
        </div>
        {selectedRecord !== null && (
          <div className="w-[420px] shrink-0">
            <TrajectoryInspector
              projection={load.projection}
              record={selectedRecord}
              sessionId={sessionId}
              onClose={() => setSelection(null)}
              onSelectRequest={(ordinal) => setSelection({ kind: 'request', ordinal })}
            />
          </div>
        )}
        {selectedRequest !== null && (
          <div className="w-[420px] shrink-0">
            <TrajectoryRequestInspector
              projection={load.projection}
              request={selectedRequest}
              sessionId={sessionId}
              onClose={() => setSelection(null)}
              onReveal={revealRecord}
            />
          </div>
        )}
      </div>
    </div>
  )
}
