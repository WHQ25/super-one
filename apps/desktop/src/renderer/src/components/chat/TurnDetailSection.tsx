import { useState, useRef, type ReactNode, type TransitionEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, List } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

interface TurnDetailSectionProps {
  children: ReactNode
  /** Number of tools in the collapsed process (shown next to the chevron). */
  toolCount?: number
  className?: string
}

/**
 * Compact-mode process disclosure. Indicator on top; content expands downward
 * with a short height animation. Callers skip this wrapper when process has
 * fewer than MIN_PROCESS_SEGMENTS_TO_COLLAPSE segments.
 */
export function TurnDetailSection({ children, toolCount = 0, className }: TurnDetailSectionProps) {
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
        <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
          {toolCount > 0 && (
            <span className="opacity-70">{toolCount}</span>
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
