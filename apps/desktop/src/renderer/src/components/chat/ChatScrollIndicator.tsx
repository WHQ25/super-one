import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import type { TurnOutlineEntry } from './turn-outline'

// Turn elements sit in document order, so their viewport-relative tops are monotonically
// non-decreasing. `topOf` returns null for a turn whose element is not mounted (lazy
// loading only mounts a contiguous suffix, so nulls form a top prefix = above threshold).
// Binary-search the last turn whose top is at/above the threshold — O(log n) rect reads.
export function findActiveTurnId(
  entries: { id: string }[],
  topOf: (id: string) => number | null,
  threshold: number,
): string | null {
  if (entries.length === 0) return null
  let lo = 0
  let hi = entries.length - 1
  let result = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const top = topOf(entries[mid].id)
    if (top === null || top <= threshold) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return entries[result].id
}

interface ChatScrollIndicatorProps {
  entries: TurnOutlineEntry[]
  hasCompact: boolean
  compactExpanded: boolean
  compactSplit: number
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

function ChatScrollIndicatorImpl({ entries, hasCompact, compactExpanded, compactSplit, viewportRef, onJump, onToggleCompact }: ChatScrollIndicatorProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ index: number; top: number } | null>(null)
  const [compactHovered, setCompactHovered] = useState<{ top: number } | null>(null)
  const [overflow, setOverflow] = useState({ above: false, below: false })
  const rafRef = useRef(0)
  const outerRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const compactRef = useRef<HTMLDivElement>(null)
  const followSuppressedUntil = useRef(0)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const elCacheRef = useRef(new Map<string, HTMLElement>())
  const [previewTop, setPreviewTop] = useState<number | null>(null)
  const [compactTop, setCompactTop] = useState<number | null>(null)
  const { t } = useTranslation()

  const clampCenter = useCallback((rawTop: number, el: HTMLElement | null): number => {
    const outer = outerRef.current
    if (!el || !outer) return rawTop
    const half = el.offsetHeight / 2
    const lo = half + 4
    const hi = outer.clientHeight - half - 4
    if (hi < lo) return outer.clientHeight / 2
    return Math.min(Math.max(rawTop, lo), hi)
  }, [])

  const computeActive = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = viewport.getBoundingClientRect().top + viewport.clientHeight * 0.25
    const cache = elCacheRef.current
    const topOf = (id: string): number | null => {
      let el = cache.get(id)
      if (!el || !el.isConnected) {
        el = viewport.querySelector(`[data-message-id="${CSS.escape(id)}"]`) as HTMLElement | null ?? undefined
        if (el) cache.set(id, el)
        else { cache.delete(id); return null }
      }
      return el.getBoundingClientRect().top
    }
    setActiveId(findActiveTurnId(entriesRef.current, topOf, threshold))
  }, [viewportRef])

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

  // Drop detached / out-of-set element refs when the outline changes (session switch,
  // compact expand, lazy mount). Prevents strong-retaining unmounted message DOM.
  useEffect(() => {
    const cache = elCacheRef.current
    const live = new Set(entries.map((e) => e.id))
    for (const id of cache.keys()) {
      if (!live.has(id)) cache.delete(id)
      else {
        const el = cache.get(id)
        if (el && !el.isConnected) cache.delete(id)
      }
    }
  }, [entries])

  // Recompute the active tick when a turn is added/removed (entries identity is stable during
  // streaming after the outline memo fix, so this no longer fires on every content delta).
  useEffect(() => {
    computeActive()
  }, [entries.length, computeActive])

  const measure = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    setOverflow({ above: el.scrollTop > 1, below: el.scrollTop + el.clientHeight < el.scrollHeight - 1 })
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, entries.length, hasCompact, compactExpanded])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  useEffect(() => {
    if (!activeId || performance.now() < followSuppressedUntil.current) return
    const btn = stripRef.current?.querySelector(`[data-tick="${CSS.escape(activeId)}"]`)
    btn?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  useLayoutEffect(() => {
    setPreviewTop(hovered ? clampCenter(hovered.top, previewRef.current) : null)
  }, [hovered, clampCenter])

  useLayoutEffect(() => {
    setCompactTop(compactHovered ? clampCenter(compactHovered.top, compactRef.current) : null)
  }, [compactHovered, clampCenter])

  if (entries.length <= 1 && !hasCompact) return null

  const preview = hovered ? entries[hovered.index] : null
  const compactBase = compactExpanded ? COMPACT_TICK : TICK_MIN
  const overflowing = overflow.above || overflow.below
  const splitAt = Math.min(compactSplit, entries.length)

  const centerTop = (el: HTMLElement): number => {
    const outer = outerRef.current
    if (!outer) return 0
    const outerRect = outer.getBoundingClientRect()
    const scale = outer.clientHeight > 0 ? outerRect.height / outer.clientHeight : 1
    const r = el.getBoundingClientRect()
    return (r.top - outerRect.top + r.height / 2) / scale
  }

  const renderCompactTick = (): React.ReactNode =>
    hasCompact && (
      <button
        type="button"
        title={compactExpanded ? t('chat.scrollIndicator.collapseTooltip') : t('chat.scrollIndicator.expandTooltip')}
        onClick={onToggleCompact}
        onMouseEnter={(ev) => setCompactHovered({ top: centerTop(ev.currentTarget) })}
        onMouseLeave={() => setCompactHovered(null)}
        style={{ width: TICK_MAX }}
        className="flex shrink-0 cursor-pointer items-center justify-end py-0.5 outline-none"
      >
        <span
          style={{ width: compactHovered ? compactBase + 4 : compactBase }}
          className="h-0.5 rounded-full bg-amber-500/80 transition-all duration-150"
        />
      </button>
    )

  const renderTick = (entry: TurnOutlineEntry, i: number): React.ReactNode => {
    const isActive = entry.id === activeId
    const dist = hovered ? Math.abs(i - hovered.index) : null
    const isHovered = dist === 0
    return (
      <button
        key={entry.id}
        type="button"
        data-tick={entry.id}
        onMouseEnter={(ev) => setHovered({ index: i, top: centerTop(ev.currentTarget) })}
        onMouseLeave={() => setHovered((h) => (h?.index === i ? null : h))}
        onClick={() => {
          followSuppressedUntil.current = performance.now() + 1000
          onJump(entry.id)
        }}
        style={{ width: TICK_MAX }}
        className="flex shrink-0 cursor-pointer items-center justify-end py-0.5 outline-none"
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
  }

  return (
    <div ref={outerRef} className="absolute right-0 top-0 z-20 h-full w-7 pr-1">
      <div
        ref={stripRef}
        onScroll={measure}
        className={cn(
          'hide-scrollbar flex h-full flex-col items-end gap-px overflow-y-auto overscroll-contain',
          overflowing ? 'justify-start' : 'justify-center',
        )}
      >
        {entries.slice(0, splitAt).map((entry, i) => renderTick(entry, i))}
        {renderCompactTick()}
        {entries.slice(splitAt).map((entry, i) => renderTick(entry, splitAt + i))}
      </div>
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-5 bg-linear-to-b from-card to-transparent transition-opacity duration-150',
          overflow.above ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-linear-to-t from-card to-transparent transition-opacity duration-150',
          overflow.below ? 'opacity-100' : 'opacity-0',
        )}
      />
      <AnimatePresence>
        {preview && hovered && (
          <motion.div
            ref={previewRef}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            style={{ top: previewTop ?? hovered.top }}
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
            ref={compactRef}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            style={{ top: compactTop ?? compactHovered.top }}
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

export const ChatScrollIndicator = memo(ChatScrollIndicatorImpl)

const TICK_MIN = 6
const TICK_RANGE = 4

function tickWidth(dist: number | null): number {
  if (dist === null || dist >= TICK_RANGE) return TICK_MIN
  const ease = (1 + Math.cos((Math.PI * dist) / TICK_RANGE)) / 2
  return Math.round(TICK_MIN + (TICK_MAX - TICK_MIN) * ease)
}
