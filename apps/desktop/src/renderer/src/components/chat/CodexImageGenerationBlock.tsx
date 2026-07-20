import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import { ImageInteractive, ImageSkeleton, ImageViewer, useImageDataUri } from './image-shared'

interface Props {
  item: ImageGenerationItem
}

export function CodexImageGenerationBlock({ item }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false)

  const isFailed = item.status === 'failed'
  const savedPath = item.savedPath
  const isWaiting = !savedPath && !isFailed
  const { dataUri, loadError } = useImageDataUri(savedPath, isFailed)

  if (isFailed) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Image generation failed.</span>
      </div>
    )
  }

  if (isWaiting) {
    return <ImageSkeleton className="my-2 h-40 w-40 rounded-md border border-border" />
  }

  if (loadError) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>Failed to load image: {loadError}</span>
      </div>
    )
  }

  if (!dataUri) {
    return <ImageSkeleton className="my-2 h-40 w-40 rounded-md border border-border" />
  }

  return (
    <>
      <ImageInteractive
        savedPath={savedPath!}
        onOpen={() => setViewerOpen(true)}
        ariaLabel={item.revisedPrompt ?? 'Generated image'}
        prompt={item.revisedPrompt}
        downloadable
        className={cn(
          'my-2 block overflow-hidden rounded-md border border-border bg-muted/30',
          'cursor-pointer transition-shadow hover:shadow-sm',
        )}
      >
        <img
          src={dataUri}
          alt={item.revisedPrompt ?? 'Generated image'}
          className="block h-40 w-auto max-w-full object-contain"
        />
      </ImageInteractive>

      <ImageViewer
        items={[item]}
        index={0}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        onIndexChange={() => {}}
      />
    </>
  )
}
