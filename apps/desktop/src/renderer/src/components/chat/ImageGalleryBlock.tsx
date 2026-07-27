import { useState } from 'react'
import { ImageIcon, AlertCircle } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import {
  ImageInteractive,
  ImageSkeleton,
  ImageViewer,
  imageFullPath,
  imageThumbPath,
  useImageMediaSrc,
} from './image-shared'

const TILE = 'h-40 flex-none overflow-hidden rounded-md border border-border'

function GalleryThumb({ item, onOpen }: { item: ImageGenerationItem; onOpen: () => void }) {
  const isFailed = item.status === 'failed'
  const thumbPath = imageThumbPath(item)
  const fullPath = imageFullPath(item)
  const isWaiting = !thumbPath && !isFailed
  const { src, loadError, onError, onLoad } = useImageMediaSrc(thumbPath, isFailed)

  if (isFailed || loadError) {
    return (
      <div className={cn(TILE, 'flex w-40 items-center justify-center border-destructive/30 bg-destructive/5 text-destructive')}>
        <AlertCircle className="size-4" />
      </div>
    )
  }

  if (isWaiting || !src) {
    return <ImageSkeleton className={cn(TILE, 'w-40')} />
  }

  return (
    <ImageInteractive
      savedPath={fullPath ?? thumbPath!}
      onOpen={onOpen}
      ariaLabel={item.revisedPrompt ?? 'Generated image'}
      prompt={item.revisedPrompt}
      downloadable
      className={cn(TILE, 'cursor-pointer bg-muted/30 transition-shadow hover:shadow-sm')}
    >
      <img
        src={src}
        alt={item.revisedPrompt ?? 'Generated image'}
        onError={onError}
        onLoad={onLoad}
        className="block h-40 w-auto object-contain"
      />
    </ImageInteractive>
  )
}

export function ImageGalleryBlock({ items }: { items: ImageGenerationItem[] }) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const openAt = (i: number) => {
    setIndex(i)
    setViewerOpen(true)
  }

  const generating = items.some((it) => it.status === 'in_progress')

  return (
    <div className="my-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span>
          {generating ? 'Generating…' : `${items.length} image${items.length === 1 ? '' : 's'} generated`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <GalleryThumb key={it.id} item={it} onOpen={() => openAt(i)} />
        ))}
      </div>

      <ImageViewer
        items={items}
        index={index}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        onIndexChange={setIndex}
      />
    </div>
  )
}
