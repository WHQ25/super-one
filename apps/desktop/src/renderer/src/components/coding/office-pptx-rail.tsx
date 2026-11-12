import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { PPTX_THUMB_WIDTH, pptxThumbCanvasHeight, pptxThumbRowHeight, pptxThumbnailIndexes } from './office-pptx-thumbs'

function sameIndexes(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((index, offset) => index === right[offset])
}

export type PptxThumbnailRenderer = {
  renderThumbnail: (index: number, target: HTMLElement, options?: { width?: number }) => Promise<() => void>
}

function PptxThumb({
  index,
  active,
  canvasHeight,
  renderer,
  onSelect,
}: {
  index: number
  active: boolean
  canvasHeight: number
  renderer: PptxThumbnailRenderer | null
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const target = canvasRef.current
    if (!target || !renderer) return
    let cancelled = false
    let cleanup: (() => void) | undefined
    void renderer.renderThumbnail(index, target, { width: PPTX_THUMB_WIDTH }).then((dispose) => {
      if (cancelled) dispose()
      else cleanup = dispose
    }).catch(() => {})
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [index, renderer])

  return (
    <button
      type="button"
      className={cn('flex w-full items-start gap-1.5 px-2 text-left', active && 'bg-accent/20')}
      aria-current={active ? 'page' : undefined}
      aria-label={t('filePreview.office.goToSlide', { number: index + 1 })}
      onClick={() => onSelect(index)}
    >
      <span className="w-5 shrink-0 pt-0.5 text-center text-[10px] tabular-nums text-muted-foreground">
        {String(index + 1).padStart(2, '0')}
      </span>
      <span
        ref={canvasRef}
        className={cn(
          'block shrink-0 overflow-hidden bg-white shadow-[inset_0_0_0_1px_var(--border)]',
          active && 'shadow-[inset_0_0_0_2px_var(--primary)]',
        )}
        style={{ width: PPTX_THUMB_WIDTH, height: canvasHeight }}
      />
    </button>
  )
}

export function OfficePptxThumbnailRail({
  count,
  active,
  aspect,
  renderer,
  onSelect,
}: {
  count: number
  active: number
  aspect: number
  renderer: PptxThumbnailRenderer | null
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const publishRef = useRef<() => void>(() => {})
  const rowHeight = pptxThumbRowHeight(aspect)
  const canvasHeight = pptxThumbCanvasHeight(aspect)
  const [indexes, setIndexes] = useState(() => pptxThumbnailIndexes(count, 0, 800, rowHeight))

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const publish = () => {
      const next = pptxThumbnailIndexes(count, el.scrollTop, el.clientHeight || 800, rowHeight)
      setIndexes((current) => sameIndexes(current, next) ? current : next)
    }
    publishRef.current = publish
    publish()
    el.addEventListener('scroll', publish, { passive: true })
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', publish)
      observer.disconnect()
      if (publishRef.current === publish) publishRef.current = () => {}
    }
  }, [count, rowHeight])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || el.clientHeight <= 0 || count <= 0) return
    const top = active * rowHeight
    const bottom = top + rowHeight
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    // Assigning scrollTop does not emit a scroll event, so the window must be refreshed here.
    publishRef.current()
  }, [active, count, rowHeight])

  return (
    <nav
      ref={scrollerRef}
      className="min-h-0 w-48 shrink-0 overflow-y-auto border-r border-border bg-muted/30"
      aria-label={t('filePreview.office.thumbnails')}
    >
      <div className="relative w-full" style={{ height: count * rowHeight }}>
        {indexes.map((index) => (
          <div
            key={index}
            className="absolute inset-x-0"
            style={{ top: index * rowHeight, height: rowHeight, paddingTop: Math.max(0, rowHeight - canvasHeight) / 2 }}
          >
            <PptxThumb
              index={index}
              active={index === active}
              canvasHeight={canvasHeight}
              renderer={renderer}
              onSelect={onSelect}
            />
          </div>
        ))}
      </div>
    </nav>
  )
}
