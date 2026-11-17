import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, GripVertical, ImageIcon, Loader2, TriangleAlert, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { GeneratedMediaItem } from './tool-display'
import { beginSwipe, endSwipe, TAP_SLOP_PX, trackSwipe, type SwipeTracking } from '../previewer-swipe'
import { LONG_PRESS_DELAY_MS } from '../long-press'

interface GalleryProps {
  items: readonly GeneratedMediaItem[]
  renderPreview: (item: GeneratedMediaItem) => ReactNode
  renderThumbnail: (item: GeneratedMediaItem) => ReactNode
}

const SIDEBAR_MIN_WIDTH = 520
const HANDLE_DRAG_PX = 20
const GROUPS = [
  { type: 'video_generation', label: 'generatedMedia.video', Icon: Video },
  { type: 'image_generation', label: 'generatedMedia.image', Icon: ImageIcon },
] as const

function mediaKey(item: GeneratedMediaItem) {
  return JSON.stringify([item.type, item.id])
}

export function GeneratedMediaPlaceholder({ pending }: { pending: boolean }) {
  const { t } = useTranslation()
  const Icon = pending ? Loader2 : TriangleAlert
  return (
    <div role="status" className={cn('flex min-h-0 flex-1 items-center justify-center gap-2 text-xs', pending ? 'text-muted-foreground' : 'text-destructive')}>
      <Icon aria-hidden className={cn('size-4', pending && 'animate-spin')} />
      {t(pending ? 'generatedMedia.pending' : 'generatedMedia.unavailable')}
    </div>
  )
}

function SidebarHandle({ expanded, controls, onChange }: {
  expanded: boolean
  controls: string
  onChange: (expanded: boolean) => void
}) {
  const { t } = useTranslation()
  const drag = useRef<{ id: number; x: number } | null>(null)
  const dragged = useRef(false)
  const label = t(expanded ? 'generatedMedia.collapse' : 'generatedMedia.expand')

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      data-generated-media-handle
      className="flex h-11 w-4 shrink-0 touch-none cursor-ew-resize items-center justify-center self-center rounded-md border border-border bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:bg-accent"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return
        drag.current = { id: event.pointerId, x: event.clientX }
        dragged.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return
        const dx = event.clientX - drag.current.x
        drag.current = null
        dragged.current = Math.abs(dx) > TAP_SLOP_PX
        if (Math.abs(dx) >= HANDLE_DRAG_PX) onChange(dx < 0)
      }}
      onLostPointerCapture={() => { drag.current = null }}
      onClick={event => {
        if (event.detail === 0 || !dragged.current) onChange(!expanded)
        dragged.current = false
      }}
    >
      <GripVertical aria-hidden className="size-3.5" />
    </button>
  )
}

function MediaSidebar({ id, expanded, items, selected, select, renderThumbnail }: {
  id: string
  expanded: boolean
  items: GalleryProps['items']
  selected: GeneratedMediaItem
  select: (item: GeneratedMediaItem) => void
  renderThumbnail: GalleryProps['renderThumbnail']
}) {
  const { t } = useTranslation()
  return (
    <div id={id} hidden={!expanded} className="relative w-[4.5rem]" aria-label={t('generatedMedia.list')} role="group">
      {expanded && (
        <div className="absolute inset-0 space-y-3 overflow-y-auto overscroll-contain px-1.5 py-1">
          {GROUPS.map(({ type, label, Icon }) => {
            const group = items.filter(item => item.type === type)
            if (group.length === 0) return null
            const titleId = `${id}-${type}`
            return (
              <div key={type}>
                <div id={titleId} className="mb-1.5 flex items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Icon aria-hidden className="size-3 shrink-0" />
                  {t(label)}
                </div>
                <ul aria-labelledby={titleId} className="flex flex-col items-center gap-1.5">
                  {group.map((item, index) => {
                    const name = item.savedPath?.split(/[\\/]/).pop() || t('generatedMedia.item', { number: index + 1 })
                    const pending = item.status === 'in_progress' && !item.savedPath
                    const failed = item.status === 'failed'
                    const FallbackIcon = failed ? TriangleAlert : pending ? Loader2 : Icon
                    return (
                      <li key={mediaKey(item)}>
                        <button
                          type="button"
                          aria-label={name}
                          aria-pressed={item === selected}
                          className={cn(
                            'flex size-12 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground outline-none hover:border-foreground/50 focus-visible:ring-2 focus-visible:ring-ring',
                            item === selected && 'ring-2 ring-primary',
                          )}
                          onClick={() => select(item)}
                        >
                          {(failed || pending ? null : renderThumbnail(item)) ?? (
                            <FallbackIcon className={cn('size-4', failed && 'text-destructive', pending && 'animate-spin')} />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function GeneratedMediaGallery({ items, renderPreview, renderThumbnail }: GalleryProps) {
  const { t } = useTranslation()
  const id = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const swipe = useRef<SwipeTracking | null>(null)
  const pressStartedAt = useRef(0)
  const suppressClick = useRef(false)
  const [wide, setWide] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [selectedKey, setSelectedKey] = useState(() => items[0] && mediaKey(items[0]))
  const index = Math.max(0, items.findIndex(item => mediaKey(item) === selectedKey))
  const selected = items[index]
  const hasItems = items.length > 0
  const sidebar = wide && items.length > 1
  const carousel = !wide && items.length > 1

  useLayoutEffect(() => {
    const element = sectionRef.current
    if (!element) return
    setWide(element.clientWidth >= SIDEBAR_MIN_WIDTH)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= SIDEBAR_MIN_WIDTH))
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasItems])

  if (!selected) return null

  const select = (item: GeneratedMediaItem) => setSelectedKey(mediaKey(item))
  const move = (offset: number) => {
    const next = items[index + offset]
    if (next) select(next)
  }

  return (
    <section ref={sectionRef} aria-labelledby={`${id}-label`} className="@container my-2 min-w-0">
      <div id={`${id}-label`} className="mb-2 text-xs font-medium">
        {t('generatedMedia.title')} <span className="ml-1 font-normal text-muted-foreground">{items.length}</span>
      </div>
      <div className="rounded-xl border border-border bg-muted/25 p-2">
        <div className="flex min-w-0 gap-1">
          <div
            className={cn('group/carousel relative h-[clamp(17rem,85cqw,23rem)] min-w-0 flex-1 rounded-lg @min-[520px]:h-[clamp(20rem,57cqw,25rem)]', carousel && 'touch-pan-y')}
            data-generated-media-carousel={carousel || undefined}
            onPointerDownCapture={event => {
              suppressClick.current = false
              if (!carousel || !event.isPrimary || event.pointerType === 'mouse') return
              const target = event.target as Element
              if (!event.currentTarget.contains(target) || target.closest('[data-media-player-chrome], [data-carousel-navigation]')) return
              swipe.current = beginSwipe(event.pointerId, event.clientX, event.clientY)
              pressStartedAt.current = event.timeStamp
            }}
            onPointerMove={event => {
              const current = swipe.current
              if (current?.pointerId === event.pointerId) swipe.current = trackSwipe(current, event.clientX, event.clientY)
            }}
            onPointerUp={event => {
              const current = swipe.current
              if (current?.pointerId !== event.pointerId) return
              swipe.current = null
              const outcome = endSwipe(trackSwipe(current, event.clientX, event.clientY))
              if (outcome === 'tap') {
                // A touch tap immediately after scrolling may not produce a browser click.
                const button = (event.target as Element).closest<HTMLButtonElement>('button')
                if (event.pointerType === 'touch' && event.timeStamp - pressStartedAt.current < LONG_PRESS_DELAY_MS
                  && button && event.currentTarget.contains(button) && !button.disabled) {
                  suppressClick.current = true
                  button.click()
                }
                return
              }
              suppressClick.current = true
              // Keep the touched media mounted until the browser dispatches touchend.
              if (outcome === 'prev' || outcome === 'next') {
                requestAnimationFrame(() => move(outcome === 'prev' ? -1 : 1))
              }
            }}
            onPointerCancel={event => {
              if (swipe.current?.pointerId !== event.pointerId) return
              swipe.current = null
              suppressClick.current = true
            }}
            onClickCapture={event => {
              if (!suppressClick.current || event.detail === 0) return
              suppressClick.current = false
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <div
              key={JSON.stringify([mediaKey(selected), selected.savedPath])}
              className="flex size-full min-w-0 flex-col rounded-lg"
              data-generated-media-preview
            >
              {renderPreview(selected)}
            </div>
            {carousel && (
              <div data-carousel-navigation className="pointer-events-none absolute inset-x-1.5 top-1/2 flex -translate-y-1/2 justify-between">
                <IconButton
                  size="md"
                  aria-label={t('generatedMedia.previous')}
                  disabled={index === 0}
                  className="pointer-events-none bg-background/90 opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 disabled:invisible"
                  onClick={() => move(-1)}
                >
                  <ChevronLeft />
                </IconButton>
                <IconButton
                  size="md"
                  aria-label={t('generatedMedia.next')}
                  disabled={index === items.length - 1}
                  className="pointer-events-none bg-background/90 opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 disabled:invisible"
                  onClick={() => move(1)}
                >
                  <ChevronRight />
                </IconButton>
              </div>
            )}
          </div>
          {sidebar && (
            <>
              <SidebarHandle expanded={expanded} controls={`${id}-items`} onChange={setExpanded} />
              <MediaSidebar id={`${id}-items`} expanded={expanded} items={items} selected={selected} select={select} renderThumbnail={renderThumbnail} />
            </>
          )}
        </div>
        {carousel && (
          <div aria-live="polite" className="pt-1.5 text-center text-xs text-muted-foreground tabular-nums" data-generated-media-counter>
            {index + 1}/{items.length}
          </div>
        )}
      </div>
    </section>
  )
}
