import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TransitionEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileDiff, List, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { TurnProcessStats } from './turn-process-stats'
import { formatCompactDuration } from './duration-format'

/** One rendered run of a turn — see `partitionTurnForCompactMode`. */
export interface TurnDetailRun {
  key: string
  /** Collapsible runs hide behind the shared Detail toggle; pinned runs always render. */
  collapsible: boolean
  content: ReactNode
}

interface TurnDetailSectionProps {
  /** Turn content in original order; pinned runs stay visible between collapsed ones. */
  runs: TurnDetailRun[]
  /** Visible tool / file / line stats collapsed under Detail. */
  stats?: TurnProcessStats
  /** While collapsed, replace Detail with a live working duration. */
  workingSince?: string | number
  className?: string
}

const fmt = (n: number) => n.toLocaleString()

/**
 * Compact-mode process disclosure. A single indicator, anchored at the first
 * collapsed run, toggles every collapsible run at once; pinned runs (markdown,
 * widgets) render in place regardless, so expanding restores the turn's original
 * order rather than re-flowing it.
 *
 * Each collapsible run animates its height (see TurnDetailRegion for how that stays
 * spacing-accurate).
 *
 * Runs are siblings, not children, so `.turn-detail-section + *` / `.turn-detail-region + *`
 * spacing rules still see the content that follows. Callers skip this wrapper when
 * process has fewer than MIN_PROCESS_SEGMENTS_TO_COLLAPSE visible segments.
 */
/**
 * One collapsible run: animates open, and still measures like Detail mode.
 *
 * Anything that can animate height — grid rows here, or overflow clipping — is a
 * formatting context, so the content's outer margins are trapped inside and would ADD
 * to the neighbour's margin instead of collapsing with it (Detail mode takes the max,
 * this would take the sum). Rather than give up the animation, the region hands those
 * two margins over: it zeroes the content's first-child margin-top / last-child
 * margin-bottom and carries the measured values on itself. A sibling's margins collapse
 * normally whatever its inner formatting context is, so the gaps come out identical to
 * Detail mode — and because the box is right from the first frame to the last, there is
 * nothing to snap when the animation ends. The margins animate alongside the height, so
 * the run's full outer size grows and shrinks in one motion.
 */
function TurnDetailRegion({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  // `mounted` outlives `open` so the collapse animation has something to shrink.
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [gap, setGap] = useState<{ top: string; bottom: string }>({ top: '0px', bottom: '0px' })
  const contentRef = useRef<HTMLDivElement>(null)

  if (expanded && !mounted) setMounted(true)
  if (!expanded && open) setOpen(false)

  useLayoutEffect(() => {
    if (!expanded || !mounted) return
    const first = contentRef.current?.firstElementChild as HTMLElement | null
    const last = contentRef.current?.lastElementChild as HTMLElement | null
    if (first && last) {
      const top = getComputedStyle(first).marginTop
      const bottom = getComputedStyle(last).marginBottom
      first.style.marginTop = '0px'
      last.style.marginBottom = '0px'
      setGap({ top: top || '0px', bottom: bottom || '0px' })
    }
    // Mounted at 0fr; expand on the next frames so the transition has a start value.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)))
    return () => {
      cancelAnimationFrame(raf)
      if (first) first.style.marginTop = ''
      if (last) last.style.marginBottom = ''
    }
  }, [expanded, mounted])

  function handleTransitionEnd(e: TransitionEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (e.propertyName !== 'grid-template-rows') return
    if (!open) setMounted(false)
  }

  return (
    <div
      data-testid="turn-detail-region"
      data-expanded={open}
      className="turn-detail-region grid"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        marginTop: open ? gap.top : '0px',
        marginBottom: open ? gap.bottom : '0px',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="min-h-0 overflow-hidden">
        {mounted && <div ref={contentRef} className="min-w-0">{children}</div>}
      </div>
    </div>
  )
}

export function TurnDetailSection({ runs, stats, workingSince, className }: TurnDetailSectionProps) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (workingSince === undefined || expanded) return
    const tick = () => setNow(Date.now())
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expanded, workingSince])
  const parsedWorkingSince = typeof workingSince === 'string'
    ? new Date(workingSince).getTime()
    : workingSince
  const workingDuration = parsedWorkingSince !== undefined && Number.isFinite(parsedWorkingSince)
    ? Math.max(0, now - parsedWorkingSince)
    : 0
  const label = !expanded && workingSince !== undefined
    ? t('chat.compactMode.workingFor', {
        duration: formatCompactDuration(workingDuration, i18n.resolvedLanguage ?? i18n.language),
      })
    : t('chat.compactMode.detail')
  // Anchor the indicator to the first collapsed run so a turn that opens with prose
  // still reads top-down: intro, Detail (standing in for the tools), answer.
  const firstCollapsible = runs.findIndex((run) => run.collapsible)

  const indicator = (
    <div className={cn('turn-detail-section mb-1.5', className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'group flex w-full items-center gap-1.5 border-b border-border/50 py-1 text-left text-xs text-muted-foreground/80',
          'transition-colors hover:text-muted-foreground',
        )}
      >
        <List className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate font-normal tracking-wide">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {stats && (stats.toolCalls > 0 || stats.filesChanged > 0 || stats.added > 0 || stats.removed > 0) && (
            <span className="flex items-center gap-1.5 text-2xs leading-none tabular-nums">
              {stats.toolCalls > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 opacity-70"
                  title={t('chat.compactMode.toolCalls', { count: stats.toolCalls })}
                >
                  <Wrench className="size-2.5" />
                  {fmt(stats.toolCalls)}
                </span>
              )}
              {stats.filesChanged > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 opacity-70"
                  title={t('chat.compactMode.filesChanged', { count: stats.filesChanged })}
                >
                  <FileDiff className="size-2.5" />
                  {fmt(stats.filesChanged)}
                </span>
              )}
              {(stats.added > 0 || stats.removed > 0) && (
                <span className="inline-flex items-baseline gap-0.5 font-mono">
                  {stats.added > 0 && (
                    <span className="text-success/80 transition-colors group-hover:text-success">+{fmt(stats.added)}</span>
                  )}
                  {stats.removed > 0 && (
                    <span className="text-error/80 transition-colors group-hover:text-error">-{fmt(stats.removed)}</span>
                  )}
                </span>
              )}
            </span>
          )}
          {expanded ? (
            <ChevronDown className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
          ) : (
            <ChevronRight className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </button>
    </div>
  )

  return (
    <>
      {runs.map((run, i) =>
        run.collapsible ? (
          <Fragment key={run.key}>
            {i === firstCollapsible && indicator}
            <TurnDetailRegion expanded={expanded}>{run.content}</TurnDetailRegion>
          </Fragment>
        ) : (
          <Fragment key={run.key}>{run.content}</Fragment>
        ),
      )}
    </>
  )
}
