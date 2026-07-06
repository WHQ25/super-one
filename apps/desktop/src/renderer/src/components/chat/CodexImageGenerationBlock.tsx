import { useState } from 'react'
import { ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import { ImageInteractive, ImageViewer, useImageDataUri } from './image-shared'

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
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <span>Generating image…</span>
      </div>
    )
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
    return (
      <div className="my-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span>Loading image…</span>
      </div>
    )
  }

  return (
    <>
      <ImageInteractive
        savedPath={savedPath!}
        onOpen={() => setViewerOpen(true)}
        ariaLabel={item.revisedPrompt ?? 'Generated image'}
        prompt={item.revisedPrompt}
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
