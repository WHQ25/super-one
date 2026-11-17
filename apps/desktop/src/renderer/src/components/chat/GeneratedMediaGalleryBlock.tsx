import { useEffect, useRef, useState } from 'react'
import { ImageIcon, Maximize2, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import type { GeneratedMediaItem } from '@superone/chat-view/presenters/tool-display'
import { GeneratedMediaGallery, GeneratedMediaPlaceholder } from '@superone/chat-view/presenters/GeneratedMediaGallery'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'
import { toLocalFileUrl } from '@/lib/path-utils'
import { encodeRemoteMediaUrl } from '@/lib/remote-media-url'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { ImageInteractive, ImageViewer, imageFullPath, imageThumbPath, useImageMediaSrc } from './image-shared'
import { MarkdownVideoPlayer } from './markdown-media-player'
import { useGalleryImagePaths } from './use-gallery-image-paths'

function ImageThumbnail({ item }: { item: ImageGenerationItem }) {
  const { src, loadError, onError } = useImageMediaSrc(imageThumbPath(item), item.status === 'failed')
  return src && !loadError
    ? <img src={src} alt="" loading="lazy" onError={onError} className="size-full object-cover" />
    : <ImageIcon aria-hidden className="size-4" />
}

function ImagePreview({ items, index }: { items: ImageGenerationItem[]; index: number }) {
  const { t } = useTranslation()
  const [viewer, setViewer] = useState({ open: false, index })
  const item = items[index]
  const fullPath = imageFullPath(item)
  const { src, loadError, onError } = useImageMediaSrc(imageThumbPath(item), item.status === 'failed')
  if (!fullPath || !src || loadError) {
    return <GeneratedMediaPlaceholder pending={item.status !== 'failed' && !loadError} />
  }

  const open = () => setViewer({ open: true, index })
  return (
    <>
      <ImageInteractive
        savedPath={fullPath}
        onOpen={open}
        ariaLabel={item.revisedPrompt ?? t('generatedMedia.openImage')}
        prompt={item.revisedPrompt}
        downloadable
        className="min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-lg bg-black"
      >
        <img src={src} alt={item.revisedPrompt ?? ''} onError={onError} className="block size-full object-contain" />
      </ImageInteractive>
      <div className="mt-1.5 flex shrink-0 justify-end border-t border-border/60 pt-1.5">
        <IconButton size="md" tooltip={t('mediaPlayer.enterFullscreen')} onClick={open}><Maximize2 /></IconButton>
      </div>
      {viewer.open && (
        <ImageViewer
          items={items}
          index={viewer.index}
          open={viewer.open}
          onOpenChange={open => setViewer(current => ({ ...current, open }))}
          onIndexChange={index => setViewer(current => ({ ...current, index }))}
        />
      )}
    </>
  )
}

function videoSource(path: string | undefined, projectPath: string | null | undefined) {
  if (!path) return undefined
  return projectPath && parseRemoteProjectKey(projectPath)
    ? encodeRemoteMediaUrl(projectPath, path)
    : toLocalFileUrl(path)
}

function VideoThumbnail({ source }: { source?: string }) {
  const tile = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [failed, setFailed] = useState(false)
  const { displaySrc } = useResolvedMediaSrc(visible ? source : undefined)

  useEffect(() => {
    if (visible || !tile.current) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    })
    observer.observe(tile.current)
    return () => observer.disconnect()
  }, [visible])

  return (
    <span ref={tile} aria-hidden className="flex size-full items-center justify-center">
      {displaySrc && !failed ? (
        <video
          src={displaySrc}
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : <Video className="size-4" />}
    </span>
  )
}

function VideoPreview({ item, source }: { item: VideoGenerationItem; source?: string }) {
  const { t } = useTranslation()
  const [loadError, setLoadError] = useState(false)
  const { displaySrc, filePath, failed, loading } = useResolvedMediaSrc(source)
  if (item.status === 'failed' || failed || loadError) return <GeneratedMediaPlaceholder pending={false} />
  if (!displaySrc || loading) return <GeneratedMediaPlaceholder pending />
  return (
    <MarkdownVideoPlayer
      src={displaySrc}
      filePath={filePath}
      aria-label={item.prompt ?? t('generatedMedia.video')}
      fitToContainer
      showPlayOverlay
      playsInline
      onError={() => setLoadError(true)}
    />
  )
}

export function GeneratedMediaGalleryBlock({ items, projectPath }: { items: GeneratedMediaItem[]; projectPath?: string | null }) {
  const sourceImages = items.filter((item): item is ImageGenerationItem => item.type === 'image_generation')
  const images = useGalleryImagePaths(sourceImages, projectPath)
  const imageIndices = new Map(sourceImages.map((item, index) => [item, index]))
  return (
    <GeneratedMediaGallery
      items={items}
      renderPreview={(item) => item.type === 'image_generation'
        ? <ImagePreview items={images} index={imageIndices.get(item)!} />
        : <VideoPreview item={item} source={videoSource(item.savedPath, projectPath)} />}
      renderThumbnail={(item) => item.type === 'image_generation'
        ? <ImageThumbnail item={images[imageIndices.get(item)!]} />
        : <VideoThumbnail key={item.savedPath} source={videoSource(item.savedPath, projectPath)} />}
    />
  )
}
