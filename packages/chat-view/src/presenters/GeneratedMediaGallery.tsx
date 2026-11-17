import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ImageIcon, Loader2, TriangleAlert, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import type { GeneratedMediaItem } from './tool-display'
import { formatClockDuration } from './duration-format'

type RenderMedia = (item: GeneratedMediaItem, onDuration: (milliseconds: number) => void) => ReactNode

interface GalleryProps {
  items: readonly GeneratedMediaItem[]
  renderPreview: RenderMedia
  renderThumbnail: RenderMedia
}

function mediaKey(item: GeneratedMediaItem) {
  return JSON.stringify([item.type, item.id])
}

function mediaLabel(item: GeneratedMediaItem) {
  return item.savedPath?.split(/[\\/]/).pop()
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

export function GeneratedMediaGallery({ items, renderPreview, renderThumbnail }: GalleryProps) {
  const { t } = useTranslation()
  const id = useId()
  const [expanded, setExpanded] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string>()
  const [durations, setDurations] = useState<Record<string, number>>({})
  const selected = items.find(item => mediaKey(item) === selectedKey) ?? items[0]
  if (!selected) return null

  const durationKey = (item: GeneratedMediaItem) => JSON.stringify([mediaKey(item), item.savedPath])
  const onDuration = (item: GeneratedMediaItem) => (milliseconds: number) => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
    const key = durationKey(item)
    setDurations(previous => previous[key] === milliseconds ? previous : { ...previous, [key]: milliseconds })
  }

  const summary = (item: GeneratedMediaItem, index: number, compact = false) => {
    const video = item.type === 'video_generation'
    const Icon = video ? Video : ImageIcon
    const duration = durations[durationKey(item)]
    const label = mediaLabel(item) || t('generatedMedia.item', { number: index + 1 })
    const pending = item.status === 'in_progress' && !item.savedPath
    const failed = item.status === 'failed'
    const ThumbnailIcon = failed ? TriangleAlert : pending ? Loader2 : Icon
    const thumbnail = failed || pending ? null : renderThumbnail(item, onDuration(item))
    return (
      <>
        <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground', compact ? 'size-7' : 'size-10')}>
          {thumbnail ?? <ThumbnailIcon aria-hidden className={cn('size-4', failed && 'text-destructive', pending && 'animate-spin')} />}
        </span>
        <span className="min-w-0 flex-1">
          <span title={label} className="block truncate text-xs font-medium">{label}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon aria-hidden className="size-3 shrink-0" />
            {t(video ? 'generatedMedia.video' : 'generatedMedia.image')}
            {video && duration !== undefined && <span className="tabular-nums">· {formatClockDuration(duration)}</span>}
            {(pending || failed) && <span className="sr-only">{t(pending ? 'generatedMedia.pending' : 'generatedMedia.unavailable')}</span>}
          </span>
        </span>
      </>
    )
  }

  return (
    <section aria-labelledby={`${id}-label`} className="@container my-2 min-w-0">
      <div id={`${id}-label`} className="mb-2 text-xs font-medium">
        {t('generatedMedia.title')} <span className="ml-1 font-normal text-muted-foreground">{items.length}</span>
      </div>
      <div className={cn(
        'grid min-w-0 gap-2 rounded-xl border border-border bg-muted/25 p-2',
        expanded && '@min-[520px]:grid-cols-[minmax(0,1fr)_10rem]',
      )}>
        <div
          key={JSON.stringify([mediaKey(selected), selected.savedPath])}
          className="flex h-[clamp(17rem,85cqw,23rem)] min-w-0 flex-col overflow-hidden rounded-lg @min-[520px]:h-[clamp(20rem,57cqw,25rem)]"
          data-generated-media-preview
        >
          {renderPreview(selected, onDuration(selected))}
        </div>
        <div className="min-w-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${id}-items`}
            aria-label={t(expanded ? 'generatedMedia.collapse' : 'generatedMedia.expand')}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? (
              <span className="min-w-0 flex-1 truncate">{t('generatedMedia.list')} · {items.length}</span>
            ) : (
              <>
                {summary(selected, items.indexOf(selected), true)}
                <span className="shrink-0 text-[11px] text-muted-foreground">{t('generatedMedia.expand')}</span>
              </>
            )}
            <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', expanded && 'rotate-180')} />
          </button>
          <ul id={`${id}-items`} hidden={!expanded} className="mt-1 space-y-1">
            {expanded && items.map((item, index) => (
              <li key={mediaKey(item)}>
                <button
                  type="button"
                  aria-pressed={item === selected}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border p-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring',
                    item === selected ? 'border-primary/40 bg-accent text-accent-foreground' : 'border-transparent hover:bg-muted',
                  )}
                  onClick={() => setSelectedKey(mediaKey(item))}
                >
                  {summary(item, index)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
