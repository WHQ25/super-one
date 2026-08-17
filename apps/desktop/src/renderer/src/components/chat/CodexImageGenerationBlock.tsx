import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { ToolIcon } from './ToolIcon'
import { CompactLabeledToolRow } from './tool-row'

interface Props {
  item: ImageGenerationItem
}

export function CodexImageGenerationBlock({ item }: Props) {
  const { t } = useTranslation()
  const [viewerOpen, setViewerOpen] = useState(false)

  const isFailed = item.status === 'failed'
  const thumbPath = imageThumbPath(item)
  const fullPath = imageFullPath(item)
  const isWaiting = !thumbPath && !isFailed
  const { src, loadError, onError, onLoad } = useImageMediaSrc(thumbPath, isFailed)

  if (isFailed) {
    return (
      <CompactLabeledToolRow
        icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}
        label={t('chat.toolBlock.generateImage')}
        summary={t('chat.codex.imageGenerationFailed')}
        tone="error"
      />
    )
  }

  if (isWaiting) {
    return <ImageSkeleton className="my-2 h-40 w-40 rounded-md border border-border" />
  }

  if (loadError) {
    return (
      <CompactLabeledToolRow
        icon={<ToolIcon icon="image" className="size-3 shrink-0 text-muted-foreground" />}
        label={t('chat.codex.loadImage')}
        summary={t('chat.codex.imageLoadFailed')}
        tone="error"
      />
    )
  }

  if (!src) {
    return <ImageSkeleton className="my-2 h-40 w-40 rounded-md border border-border" />
  }

  return (
    <>
      <ImageInteractive
        savedPath={fullPath ?? thumbPath!}
        onOpen={() => setViewerOpen(true)}
        ariaLabel={item.revisedPrompt ?? t('chat.codex.generatedImageAlt')}
        prompt={item.revisedPrompt}
        downloadable
        className={cn(
          'my-2 block overflow-hidden rounded-md border border-border bg-muted/30',
          'cursor-pointer transition-shadow hover:shadow-sm',
        )}
      >
        <img
          src={src}
          alt={item.revisedPrompt ?? t('chat.codex.generatedImageAlt')}
          onError={onError}
          onLoad={onLoad}
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
