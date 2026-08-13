import { useState, useRef, type ReactNode, type TransitionEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileDiff, List, Wrench } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { TurnProcessStats } from './turn-process-stats'

interface TurnDetailSectionProps {
  children: ReactNode
  /** Visible tool / file / line stats collapsed under Detail. */
  stats?: TurnProcessStats
  className?: string
}

const fmt = (n: number) => n.toLocaleString()

/**
 * Compact-mode process disclosure. Indicator on top; content expands downward
 * with a short height animation. Callers skip this wrapper when process has
 * fewer than MIN_PROCESS_SEGMENTS_TO_COLLAPSE segments.
 */
export function TurnDetailSection({ children, stats, className }: TurnDetailSectionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  // Keep children mounted through the collapse animation so grid can animate to 0fr.
  const [mounted, setMounted] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const label = t('chat.compactMode.detail')

  function open() {
    // Mount at 0fr first, then expand on the next frames so the transition runs.
    setMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setExpanded(true))
    })
  }

  function close() {
    setExpanded(false)
  }

  function handleTransitionEnd(e: TransitionEvent<HTMLDivElement>) {
    if (e.target !== gridRef.current) return
    if (e.propertyName !== 'grid-template-rows') return
    if (!expanded) setMounted(false)
  }

  return (
    <div className={cn('turn-detail-section mb-1.5', className)}>
      <button
        type="button"
        onClick={() => (expanded ? close() : open())}
        className={cn(
          'group flex w-full items-center gap-1.5 border-b border-border/50 py-1 text-left text-xs text-muted-foreground/80',
          'transition-colors hover:text-muted-foreground',
        )}
      >
        <List className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate font-normal tracking-wide">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {stats && (stats.toolCalls > 0 || stats.filesChanged > 0 || stats.added > 0 || stats.removed > 0) && (
            <span className="flex items-center gap-1.5 text-[10px] leading-none tabular-nums">
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

      <div
        ref={gridRef}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="min-h-0 overflow-hidden">
          {mounted && (
            <div className="min-w-0 pt-1.5 pb-0.5">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
