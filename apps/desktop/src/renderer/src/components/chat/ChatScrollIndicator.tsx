import { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@superone/ui/lib/utils'
import type { TurnOutlineEntry } from './turn-outline'

import { findActiveTurnId, tickWidth, TICK_MAX } from '@superone/shared/chat-scroll-indicator'
export { findActiveTurnId } from '@superone/shared/chat-scroll-indicator'

interface ChatScrollIndicatorProps {
  entries: TurnOutlineEntry[]
  viewportRef: React.RefObject<HTMLDivElement | null>
  getMessageTop?: (id: string) => number | null
  onJump: (id: string) => void
}


function splitTitle(text: string): { title: string; summary: string } {
  const nl = text.indexOf('\n')
  if (nl === -1) return { title: text, summary: '' }
  return { title: text.slice(0, nl), summary: text.slice(nl + 1).trim() }
}

function ChatScrollIndicatorImpl({ entries, viewportRef, getMessageTop, onJump }: ChatScrollIndicatorProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ index: number; top: number } | null>(null)
  const [overflow, setOverflow] = useState({ above: false, below: false })
  const rafRef = useRef(0)
  const outerRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const followSuppressedUntil = useRef(0)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const elCacheRef = useRef(new Map<string, HTMLElement>())
  const [previewTop, setPreviewTop] = useState<number | null>(null)
  const { t } = useTranslation()
  const labelOf = (entry: TurnOutlineEntry): string => entry.kind === 'compact' ? t('chat.compaction.compacted') : entry.text

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
      if (getMessageTop) return getMessageTop(id)
      let el = cache.get(id)
      if (!el || !el.isConnected) {
        el = viewport.querySelector(`[data-message-id="${CSS.escape(id)}"]`) as HTMLElement | null ?? undefined
        if (el) cache.set(id, el)
        else { cache.delete(id); return null }
      }
      return el.getBoundingClientRect().top
    }
    setActiveId(findActiveTurnId(entriesRef.current, topOf, threshold))
  }, [viewportRef, getMessageTop])

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
  }, [measure, entries.length])

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

  if (entries.length <= 1) return null

  const preview = hovered ? entries[hovered.index] : null
  const overflowing = overflow.above || overflow.below

  const centerTop = (el: HTMLElement): number => {
    const outer = outerRef.current
    if (!outer) return 0
    const outerRect = outer.getBoundingClientRect()
    const scale = outer.clientHeight > 0 ? outerRect.height / outer.clientHeight : 1
    const r = el.getBoundingClientRect()
    return (r.top - outerRect.top + r.height / 2) / scale
  }

  const renderTick = (entry: TurnOutlineEntry, i: number): React.ReactNode => {
    const isActive = entry.id === activeId
    const dist = hovered ? Math.abs(i - hovered.index) : null
    const isHovered = dist === 0
    return (
      <button
        key={entry.id}
        type="button"
        data-tick={entry.id}
        aria-label={labelOf(entry)}
        aria-current={isActive ? 'step' : undefined}
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
    <div ref={outerRef} data-chat-scroll-indicator className="absolute right-0 top-0 z-20 h-full w-7 pr-1">
      <div
        ref={stripRef}
        onScroll={measure}
        className={cn(
          'hide-scrollbar flex h-full flex-col items-end gap-px overflow-y-auto overscroll-contain',
          overflowing ? 'justify-start' : 'justify-center',
        )}
      >
        {entries.map(renderTick)}
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
            role="tooltip"
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.12 }}
            style={{ top: previewTop ?? hovered.top }}
            className="pointer-events-none absolute right-9 w-64 -translate-y-1/2 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-lg"
          >
            {(() => {
              const { title, summary } = splitTitle(labelOf(preview))
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
    </div>
  )
}

export const ChatScrollIndicator = memo(ChatScrollIndicatorImpl)
