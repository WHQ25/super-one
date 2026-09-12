import type { ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import { AlertCircle, ImageIcon } from 'lucide-react'
import { GALLERY_TILE, PortableGalleryHeader, PortableGalleryImage, PortableNativeGallery } from './PortableNativeGallery'

/** Same caption as the desktop `ImageGalleryBlock`. */
export function imageGalleryCaption(items: ImageGenerationItem[]): string {
  if (items.some((item) => item.status === 'in_progress')) return 'Generating…'
  return `${items.length} image${items.length === 1 ? '' : 's'} generated`
}

/**
 * Turn-end image gallery, laid out like the desktop block: a muted caption and
 * a wrapping row of fixed-height tiles. An item without a file yet is a
 * skeleton tile; a failed one is a flagged tile, so the row keeps its shape.
 */
export function PortableImageGallery({ items }: { items: ImageGenerationItem[] }) {
  return (
    <div className="my-2" data-portable-image-gallery>
      <PortableGalleryHeader kind="image">{imageGalleryCaption(items)}</PortableGalleryHeader>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          if (item.savedPath) return <PortableGalleryImage key={item.id} item={item} />
          if (item.status === 'failed') {
            return (
              <div
                key={item.id}
                className={`${GALLERY_TILE} flex w-40 items-center justify-center border-destructive/30 bg-destructive/5 text-destructive`}
                title={item.revisedPrompt}
                data-portable-image-placeholder="failed"
              >
                <AlertCircle className="size-4" />
              </div>
            )
          }
          return (
            <div
              key={item.id}
              className={`${GALLERY_TILE} flex w-40 animate-pulse items-center justify-center`}
              role="status"
              aria-busy="true"
              aria-label="Generating image"
              data-portable-image-placeholder="pending"
            >
              <ImageIcon className="size-6 text-muted-foreground" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Turn-end video cards. Only a finished video has a path to preview; an
 * in-flight one is represented by its still-visible submit tool row.
 */
export function PortableVideoGallery({ items }: { items: VideoGenerationItem[] }) {
  const available = items.filter((item) => Boolean(item.savedPath))
  if (available.length === 0) return null
  const title = `${available.length} video${available.length === 1 ? '' : 's'} generated`
  return (
    <PortableNativeGallery
      payload={{ kind: 'native', nativeType: 'video-gallery', title, videos: available }}
    />
  )
}
