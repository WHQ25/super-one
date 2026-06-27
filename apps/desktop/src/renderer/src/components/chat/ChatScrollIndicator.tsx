import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import type { TurnOutlineEntry } from './turn-outline'

interface ChatScrollIndicatorProps {
  entries: TurnOutlineEntry[]
  hasCompact: boolean
  compactExpanded: boolean
  viewportRef: React.RefObject<HTMLDivElement | null>
  onJump: (id: string) => void
  onToggleCompact: () => void
}

const TICK_MAX = 22
const COMPACT_TICK = 12

function splitTitle(text: string): { title: string; summary: string } {
  const nl = text.indexOf('\n')
  if (nl === -1) return { title: text, summary: '' }
  return { title: text.slice(0, nl), summary: text.slice(nl + 1).trim() }
}

export function ChatScrollIndicator({ entries, hasCompact, compactExpanded, viewportRef, onJump, onToggleCompact }: ChatScrollIndicatorProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ index: number; top: number } | null>(null)
  const [compactHovered, setCompactHovered] = useState<{ top: number } | null>(null)
  const rafRef = useRef(0)
  const { t } = useTranslation()

  const computeActive = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = viewport.getBoundingClientRect().top + viewport.clientHeight * 0.25
    let next: string | null = entries[0]?.id ?? null
    for (const entry of entries) {
      const el = viewport.querySelector(`[data-message-id="${CSS.escape(entry.id)}"]`)
      if (!el) continue
      if (el.getBoundingClientRect().top <= threshold) next = entry.id
      else break
    }
    setActiveId(next)
  }, [entries, viewportRef])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onScroll = (): void => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        computeActive()
      })
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    computeActive()
    return () => {
      viewport.removeEventListener('scroll', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [computeActive, viewportRef])

  if (entries.length <= 1 && !hasCompact) return null

  const preview = hovered ? entries[hovered.index] : null
  const compactBase = compactExpanded ? COMPACT_TICK : TICK_MIN

  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-7 flex-col items-end justify-center gap-0.5 pr-1">
      {hasCompact && (
        <button
          type="button"
          title={compactExpanded ? t('chat.scrollIndicator.collapseTooltip') : t('chat.scrollIndicator.expandTooltip')}
          onClick={onToggleCompact}
          onMouseEnter={(ev) => setCompactHovered({ top: ev.currentTarget.offsetTop + ev.currentTarget.offsetHeight / 2 })}
          onMouseLeave={() => setCompactHovered(null)}
          style={{ width: TICK_MAX }}
          className="flex cursor-pointer items-center justify-end py-0.5 outline-none"
        >
          <span
            style={{ width: compactHovered ? compactBase + 4 : compactBase }}
            className="h-0.5 rounded-full bg-amber-500/80 transition-all duration-150"
          />
        </button>
      )}
      {entries.map((entry, i) => {
        const isActive = entry.id === activeId
        const dist = hovered ? Math.abs(i - hovered.index) : null
        const isHovered = dist === 0
        return (
          <button
            key={entry.id}
            type="button"
            onMouseEnter={(ev) => setHovered({ index: i, top: ev.currentTarget.offsetTop + ev.currentTarget.offsetHeight / 2 })}
            onMouseLeave={() => setHovered((h) => (h?.index === i ? null : h))}
            onClick={() => onJump(entry.id)}
            style={{ width: TICK_MAX }}
            className="flex cursor-pointer items-center justify-end py-0.5 outline-none"
          >
            <span
              style={{ width: tickWidth(dist) }}
              className={cn(
                'h-0.5 rounded-full transition-all duration-150',
                isActive ? 'bg-primary' : isHovered ? 'bg-foreground/80' : 'bg-foreground/15',
              )}
            />
          </button>
        )
      })}
      <AnimatePresence>
        {preview && hovered && (
          <motion.div
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            style={{ top: hovered.top }}
            className="pointer-events-none absolute right-9 w-64 -translate-y-1/2 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg"
          >
            {(() => {
              const { title, summary } = splitTitle(preview.text)
              return (
                <>
                  <p className="line-clamp-1 text-xs font-medium">{title}</p>
                  {summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{summary}</p>}
                  {preview.reply && (
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground/80">{preview.reply}</p>
                  )}
                </>
              )
            })()}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {compactHovered && (
          <motion.div
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            style={{ top: compactHovered.top }}
            className="pointer-events-none absolute right-9 w-64 -translate-y-1/2 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <span className="h-0.5 w-3 shrink-0 rounded-full bg-amber-500/80" />
              {t('chat.scrollIndicator.compactTitle')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {compactExpanded ? t('chat.scrollIndicator.compactExpandedDesc') : t('chat.scrollIndicator.compactCollapsedDesc')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const TICK_MIN = 6
const TICK_RANGE = 4

function tickWidth(dist: number | null): number {
  if (dist === null || dist >= TICK_RANGE) return TICK_MIN
  const ease = (1 + Math.cos((Math.PI * dist) / TICK_RANGE)) / 2
  return Math.round(TICK_MIN + (TICK_MAX - TICK_MIN) * ease)
}
