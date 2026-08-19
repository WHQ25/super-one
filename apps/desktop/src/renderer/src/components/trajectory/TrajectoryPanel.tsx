import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, Route } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import type { TrajectoryProjection } from '@superone/shared/trajectory-types'
import { TrajectoryInspector } from './TrajectoryInspector'
import { TrajectoryNotice } from './TrajectoryNotice'
import { TrajectoryLedger } from './TrajectoryLedger'
import { TrajectoryToolbar } from './TrajectoryToolbar'
import { stepKey } from './trajectory-rows'

/**
 * How long the panel waits after the last agent event before re-reading the log.
 *
 * A streaming turn produces events far faster than a projection is worth
 * recomputing, and the ledger is an inspection surface rather than a live
 * transcript — the chat panel already covers watching tokens arrive.
 */
const REFRESH_DEBOUNCE_MS = 600

/** Fetch state for one session's projection. */
type Load =
  | { status: 'loading' }
  | { status: 'ready'; projection: TrajectoryProjection }
  /** The session has not run a turn, so dsh holds no log for it yet. */
  | { status: 'absent' }
  | { status: 'failed'; error: string }

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
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foldedTurns, setFoldedTurns] = useState<ReadonlySet<number>>(new Set())
  const [foldedSteps, setFoldedSteps] = useState<ReadonlySet<string>>(new Set())

  const read = useCallback(async () => {
    setRefreshing(true)
    const result = await window.app.readDeepseekTrajectory(sessionId)
    setRefreshing(false)
    setLoad(result.ok
      ? { status: 'ready', projection: result.trajectory }
      : result.reason === 'absent'
        ? { status: 'absent' }
        : { status: 'failed', error: result.error })
  }, [sessionId])

  useEffect(() => {
    setLoad({ status: 'loading' })
    setSelectedId(null)
    void read()
  }, [read])

  // Re-read after the session settles, so a ledger left open while a turn runs
  // does not silently show a stale window.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const off = window.agent.onAgentEvent((event) => {
      if (event.sessionId !== sessionId) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void read(), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [sessionId, read])

  const projection = load.status === 'ready' ? load.projection : null

  const selected = useMemo(
    () => projection?.records.find((record) => record.id === selectedId) ?? null,
    [projection, selectedId],
  )

  const allTurns = useMemo(() => projection?.turns.map((turn) => turn.turn) ?? [], [projection])
  const allSteps = useMemo(() => {
    const steps = new Set<string>()
    for (const record of projection?.records ?? []) {
      if (record.kind === 'tool') steps.add(stepKey(record.turn, record.step))
    }
    return [...steps]
  }, [projection])

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
        action={<RetryButton onClick={() => void read()} disabled={refreshing} label={t('trajectory.notice.retry')} />}
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
        action={<RetryButton onClick={() => void read()} disabled={refreshing} label={t('trajectory.notice.retry')} />}
      />
    )
  }
  if (load.projection.records.length === 0) {
    return (
      <TrajectoryNotice
        icon={Route}
        title={t('trajectory.notice.emptyTitle')}
        detail={t('trajectory.notice.emptyDetail')}
        action={<RetryButton onClick={() => void read()} disabled={refreshing} label={t('trajectory.notice.retry')} />}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <TrajectoryToolbar
        projection={load.projection}
        query={query}
        onQueryChange={setQuery}
        turnsFolded={turnsFolded}
        callsFolded={callsFolded}
        onToggleAllTurns={() => setFoldedTurns(turnsFolded ? new Set() : new Set(allTurns))}
        onToggleAllCalls={() => setFoldedSteps(callsFolded ? new Set() : new Set(allSteps))}
        onRefresh={() => void read()}
        refreshing={refreshing}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <TrajectoryLedger
            projection={load.projection}
            query={query}
            foldedTurns={foldedTurns}
            foldedSteps={foldedSteps}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleTurn={toggleTurn}
            onToggleStep={toggleStep}
          />
        </div>
        {selected !== null && (
          <div className="w-[420px] shrink-0">
            <TrajectoryInspector
              projection={load.projection}
              record={selected}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
