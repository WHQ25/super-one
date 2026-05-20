import { useState } from 'react'
import { ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { CodexImageGenerationItem } from '@superone/shared/agent-types'
import { ImageInteractive, CodexImageViewer, useImageDataUri } from './codex-image-shared'

const TILE = 'h-40 flex-none overflow-hidden rounded-md border border-border'

function GalleryThumb({ item, onOpen }: { item: CodexImageGenerationItem; onOpen: () => void }) {
  const isFailed = item.status === 'failed'
  const savedPath = item.savedPath
  const isWaiting = !savedPath && !isFailed
  const { dataUri, loadError } = useImageDataUri(savedPath, isFailed)

  if (isFailed || loadError) {
    return (
      <div className={cn(TILE, 'flex w-40 items-center justify-center border-destructive/30 bg-destructive/5 text-destructive')}>
        <AlertCircle className="size-4" />
      </div>
    )
  }

  if (isWaiting || !dataUri) {
    return (
      <div className={cn(TILE, 'flex w-40 items-center justify-center bg-muted/40 text-muted-foreground')}>
        {isWaiting ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
      </div>
    )
  }

  return (
    <ImageInteractive
      savedPath={savedPath!}
      onOpen={onOpen}
      ariaLabel={item.revisedPrompt ?? 'Generated image'}
      className={cn(TILE, 'cursor-pointer bg-muted/30 transition-shadow hover:shadow-sm')}
    >
      <img
        src={dataUri}
        alt={item.revisedPrompt ?? 'Generated image'}
        className="block h-40 w-auto object-contain"
      />
    </ImageInteractive>
  )
}

export function CodexImageGalleryBlock({ items }: { items: CodexImageGenerationItem[] }) {
  const [viewerOpen, setViewerOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const openAt = (i: number) => {
    setIndex(i)
    setViewerOpen(true)
  }

  return (
    <div className="my-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span>{items.length} image{items.length === 1 ? '' : 's'} generated</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <GalleryThumb key={it.id} item={it} onOpen={() => openAt(i)} />
        ))}
      </div>

      <CodexImageViewer
        items={items}
        index={index}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        onIndexChange={setIndex}
      />
    </div>
  )
}
