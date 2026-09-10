import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findActiveTurnId, tickWidth } from '@superone/shared/chat-scroll-indicator'
import type { TurnOutlineEntry } from '@superone/shared/turn-outline'
import type { ChatWindowRange } from './chat-window'
import './chat-scroll-indicator.css'

type Tick = { entry: TurnOutlineEntry } | { compact: true; id?: string }
type Preview = { index: number; top: number }

interface Props {
  entries: TurnOutlineEntry[]
  range: ChatWindowRange
  hasCompact: boolean
  compactExpanded: boolean
  compactSplit: number
  compactMarkers?: { id: string; index: number }[]
  onJump: (id: string) => void
  onToggleCompact: () => void
}

/** Desktop's outline, with touch scrubbing and a bounded transcript DOM window. */
export const ChatScrollIndicator = memo(function ChatScrollIndicator({
  entries, range, hasCompact, compactExpanded, compactSplit, compactMarkers, onJump, onToggleCompact,
}: Props) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewTop, setPreviewTop] = useState(0)
  const [overflow, setOverflow] = useState({ above: false, below: false })
  const outerRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const suppressedUntil = useRef(0)
  const drag = useRef<{ pointerId: number; y: number; index: number } | null>(null)
  const dragFrame = useRef(0)
  const ticks = useMemo<Tick[]>(() => {
    const result: Tick[] = entries.map((entry) => ({ entry }))
    if (compactMarkers) {
      for (const marker of [...compactMarkers].reverse()) {
        const position = entries.findIndex(entry => entry.index > marker.index)
        result.splice(position < 0 ? entries.length : position, 0, { compact: true, id: marker.id })
      }
    } else if (hasCompact) result.splice(Math.min(compactSplit, result.length), 0, { compact: true })
    return result
  }, [entries, hasCompact, compactSplit, compactMarkers])

  useEffect(() => {
    let frame = 0
    const cache = new Map<string, HTMLElement>()
    const compute = () => {
      frame = 0
      setActiveId(findActiveTurnId(entries, (id) => {
        const entry = entriesById.get(id)!
        // Unlike desktop's suffix window, mobile also unmounts *later* turns.
        // Those lie below the viewport, never above the active-turn threshold.
        if (entry.index >= range.end) return Infinity
        if (entry.index < range.start) return null
        let element = cache.get(id)
        if (!element?.isConnected) {
          element = document.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(id)}"]`) ?? undefined
          if (element) cache.set(id, element)
          else { cache.delete(id); return null }
        }
        return element.getBoundingClientRect().top
      }, window.innerHeight * 0.25))
    }
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
    const schedule = () => { if (!frame) frame = requestAnimationFrame(compute) }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(document.body)
    compute()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [entries, range.start, range.end])

  const measure = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    const above = strip.scrollTop > 1
    const below = strip.scrollTop + strip.clientHeight < strip.scrollHeight - 1
    setOverflow((old) => old.above === above && old.below === below ? old : { above, below })
  }, [])

  useLayoutEffect(() => {
    measure()
    const strip = stripRef.current
    if (!strip) return
    const observer = new ResizeObserver(measure)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [measure, ticks.length])

  useEffect(() => {
    if (!activeId || drag.current || performance.now() < suppressedUntil.current) return
    const strip = stripRef.current
    const button = strip?.querySelector<HTMLElement>(`[data-tick="${CSS.escape(activeId)}"]`)
    if (!strip || !button) return
    // scrollIntoView would also move the page and undo the user's navigation.
    const box = button.getBoundingClientRect()
    const bounds = strip.getBoundingClientRect()
    if (box.top < bounds.top) strip.scrollTop += box.top - bounds.top
    else if (box.bottom > bounds.bottom) strip.scrollTop += box.bottom - bounds.bottom
  }, [activeId, ticks])

  const showPreview = useCallback((index: number, target: HTMLElement) => {
    const bounds = outerRef.current?.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    setPreview({ index, top: box.top + box.height / 2 - (bounds?.top ?? 0) })
  }, [])

  useLayoutEffect(() => {
    if (!preview) return
    const height = outerRef.current?.clientHeight ?? 0
    const half = (previewRef.current?.offsetHeight ?? 0) / 2
    setPreviewTop(height < half * 2 + 8 ? height / 2 : Math.max(half + 4, Math.min(preview.top, height - half - 4)))
  }, [preview])

  const selectAt = useCallback((y: number) => {
    const strip = stripRef.current
    const first = strip?.querySelector<HTMLElement>('[data-outline-index="0"]')
    if (!strip || !first || !ticks.length) return
    const box = first.getBoundingClientRect()
    const index = Math.max(0, Math.min(ticks.length - 1, Math.floor((y - box.top) / box.height)))
    if (drag.current) drag.current.index = index
    const target = strip.querySelector<HTMLElement>(`[data-outline-index="${index}"]`)
    if (target) showPreview(index, target)
  }, [ticks.length, showPreview])

  const stopDrag = useCallback(() => {
    drag.current = null
    cancelAnimationFrame(dragFrame.current)
    dragFrame.current = 0
    setPreview(null)
  }, [])

  useEffect(() => stopDrag, [stopDrag, ticks])

  const activate = (index: number) => {
    const tick = ticks[index]
    if (!tick) return
    suppressedUntil.current = performance.now() + 1000
    if ('compact' in tick) { if (tick.id) onJump(tick.id); else onToggleCompact() }
    else onJump(tick.entry.id)
  }

  if (entries.length <= 1 && !hasCompact && !compactMarkers?.length) return null
  const selected = preview ? ticks[preview.index] : null
  const previewEntry = selected && 'entry' in selected ? selected.entry : null
  const newline = previewEntry?.text.indexOf('\n') ?? -1
  const title = previewEntry ? (newline < 0 ? previewEntry.text : previewEntry.text.slice(0, newline)) : ''
  const summary = previewEntry && newline >= 0 ? previewEntry.text.slice(newline + 1).trim() : ''
  const compactLabel = compactExpanded ? t('chat.scrollIndicator.collapseTooltip') : t('chat.scrollIndicator.expandTooltip')

  // `preview` is set by touch scrubbing, mouse hover and keyboard focus alike, so
  // it doubles as the "user is on the rail" signal that widens the overlay.
  return <nav ref={outerRef} className="chat-scroll-indicator" aria-label="Conversation navigation"
    data-open={preview ? 'true' : undefined}>
    <div ref={stripRef} className="chat-scroll-strip" data-overflow={overflow.above || overflow.below}
      onScroll={measure}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, y: event.clientY, index: 0 }
        selectAt(event.clientY)
        let lastTime = performance.now()
        const step = (time: number) => {
          const current = drag.current
          const strip = stripRef.current
          if (!current || !strip) return
          const box = strip.getBoundingClientRect()
          const edge = 36
          const velocity = current.y < box.top + edge ? -Math.min(1, (box.top + edge - current.y) / edge)
            : current.y > box.bottom - edge ? Math.min(1, (current.y - box.bottom + edge) / edge) : 0
          strip.scrollTop += velocity * Math.min(time - lastTime, 32) * 0.35
          lastTime = time
          selectAt(current.y)
          dragFrame.current = requestAnimationFrame(step)
        }
        dragFrame.current = requestAnimationFrame(step)
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current.y = event.clientY
        selectAt(event.clientY)
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        const index = drag.current.index
        stopDrag()
        event.currentTarget.releasePointerCapture(event.pointerId)
        activate(index)
      }}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onKeyDown={(event) => {
        const index = Number((event.target as HTMLElement).dataset.outlineIndex)
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, ticks.length - 1)
          : event.key === 'ArrowUp' ? Math.max(0, index - 1)
            : event.key === 'Home' ? 0 : event.key === 'End' ? ticks.length - 1 : null
        if (next === null) return
        event.preventDefault()
        suppressedUntil.current = performance.now() + 1000
        stripRef.current?.querySelector<HTMLButtonElement>(`[data-outline-index="${next}"]`)?.focus({ preventScroll: true })
        const button = stripRef.current?.querySelector<HTMLElement>(`[data-outline-index="${next}"]`)
        if (button && stripRef.current) {
          const box = button.getBoundingClientRect(), bounds = stripRef.current.getBoundingClientRect()
          if (box.top < bounds.top) stripRef.current.scrollTop += box.top - bounds.top
          if (box.bottom > bounds.bottom) stripRef.current.scrollTop += box.bottom - bounds.bottom
          showPreview(next, button)
        }
      }}>
      <div className="chat-scroll-rail">{ticks.map((tick, index) => {
        const compact = 'compact' in tick
        const entry = compact ? null : tick.entry
        const active = entry?.id === activeId
        const hovered = preview?.index === index
        const outlineIndex = index - (hasCompact && index > compactSplit ? 1 : 0)
        const previewIndex = preview ? preview.index - (hasCompact && preview.index > compactSplit ? 1 : 0) : 0
        const distance = previewEntry ? Math.abs(outlineIndex - previewIndex) : null
        return <button type="button" key={entry?.id ?? (compact ? tick.id : undefined) ?? 'compact'} data-outline-index={index}
          data-tick={entry?.id} data-compact-tick={compact || undefined}
          aria-label={entry?.text || (compactMarkers ? t('chat.scrollIndicator.compactTitle') : compactLabel)} aria-current={active ? 'step' : undefined}
          aria-expanded={compact && !compactMarkers ? compactExpanded : undefined}
          className="chat-scroll-tick"
          onPointerEnter={(event) => { if (event.pointerType === 'mouse') showPreview(index, event.currentTarget) }}
          onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPreview(null) }}
          onFocus={(event) => showPreview(index, event.currentTarget)} onBlur={() => setPreview(null)}
          onClick={(event) => {
            // Pointer release already navigated. WebKit can suppress click when
            // showing a hover preview, so only keyboard/AT relies on this event.
            if (event.detail === 0) activate(index)
          }}>
          <span data-active={active} data-hovered={hovered} data-compact={compact}
            style={{ width: compact ? (compactExpanded ? 12 : 6) + (hovered ? 4 : 0) : tickWidth(distance) }} />
        </button>
      })}</div>
    </div>
    <div className="chat-scroll-fade top" data-visible={overflow.above} />
    <div className="chat-scroll-fade bottom" data-visible={overflow.below} />
    {selected && preview && <div ref={previewRef} className="chat-scroll-preview" role="tooltip" style={{ top: previewTop }}>
      {previewEntry ? <>
        <p className="chat-scroll-preview-title">{title}</p>
        {summary && <p className="chat-scroll-preview-summary">{summary}</p>}
        {previewEntry.reply && <p className="chat-scroll-preview-reply">{previewEntry.reply}</p>}
      </> : <>
        <p className="chat-scroll-preview-title">{t('chat.scrollIndicator.compactTitle')}</p>
        {!compactMarkers && <p className="chat-scroll-preview-summary">{t(compactExpanded ? 'chat.scrollIndicator.compactExpandedDesc' : 'chat.scrollIndicator.compactCollapsedDesc')}</p>}
      </>}
    </div>}
  </nav>
})
