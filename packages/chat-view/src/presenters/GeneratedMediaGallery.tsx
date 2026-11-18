import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ImageIcon, Images, Loader2, Play, TriangleAlert, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import type { GeneratedMediaItem } from './tool-display'
import { beginSwipe, endSwipe, trackSwipe, type SwipeTracking } from '../previewer-swipe'
import { LONG_PRESS_DELAY_MS } from '../long-press'

interface GalleryProps {
  items: readonly GeneratedMediaItem[]
  renderPreview: (item: GeneratedMediaItem) => ReactNode
  renderThumbnail: (item: GeneratedMediaItem) => ReactNode
}

const SIDEBAR_MIN_WIDTH = 520
const NAV_ARROW = 'pointer-events-none size-8 rounded-full border border-border/50 bg-background/80 opacity-0 shadow-sm backdrop-blur-sm focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/carousel:pointer-events-auto group-hover/carousel:opacity-100 disabled:invisible'

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

function MediaSidebar({ items, selected, select, renderThumbnail }: {
  items: GalleryProps['items']
  selected: GeneratedMediaItem
  select: (item: GeneratedMediaItem) => void
  renderThumbnail: GalleryProps['renderThumbnail']
}) {
  const { t } = useTranslation()
  return (
    <div className="relative w-16 shrink-0">
      <ul aria-label={t('generatedMedia.list')} className="absolute inset-0 flex flex-col items-center gap-2 overflow-y-auto overscroll-contain py-1">
        {items.map((item, index) => {
          const name = item.savedPath?.split(/[\\/]/).pop() || t('generatedMedia.item', { number: index + 1 })
          const pending = item.status === 'in_progress' && !item.savedPath
          const failed = item.status === 'failed'
          const video = item.type === 'video_generation'
          const FallbackIcon = failed ? TriangleAlert : pending ? Loader2 : video ? Video : ImageIcon
          const thumbnail = failed || pending ? null : renderThumbnail(item)
          return (
            <li key={mediaKey(item)}>
              <button
                type="button"
                aria-label={name}
                aria-pressed={item === selected}
                className={cn(
                  'relative flex size-12 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
                  item === selected && 'opacity-100 ring-2 ring-foreground ring-offset-2 ring-offset-background',
                )}
                onClick={() => select(item)}
              >
                {thumbnail ?? <FallbackIcon className={cn('size-4', failed && 'text-destructive', pending && 'animate-spin')} />}
                {video && thumbnail && (
                  <span aria-hidden className="absolute bottom-0.5 left-0.5 flex rounded-sm bg-black/60 p-0.5 text-white">
                    <Play className="size-2 fill-current" />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
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
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <Images aria-hidden className="size-3.5 text-muted-foreground" />
        <span id={`${id}-label`} className="font-medium">{t('generatedMedia.title')}</span>
        <span aria-live={carousel ? 'polite' : undefined} className="text-muted-foreground tabular-nums" data-generated-media-counter={carousel || undefined}>
          {carousel ? `${index + 1}/${items.length}` : items.length}
        </span>
      </div>
      <div className="flex min-w-0 gap-2">
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
            <div data-carousel-navigation className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
              <IconButton
                size="md"
                aria-label={t('generatedMedia.previous')}
                disabled={index === 0}
                className={NAV_ARROW}
                onClick={() => move(-1)}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                size="md"
                aria-label={t('generatedMedia.next')}
                disabled={index === items.length - 1}
                className={NAV_ARROW}
                onClick={() => move(1)}
              >
                <ChevronRight />
              </IconButton>
            </div>
          )}
        </div>
        {sidebar && (
          <MediaSidebar items={items} selected={selected} select={select} renderThumbnail={renderThumbnail} />
        )}
      </div>
    </section>
  )
}
