import type { ImageGenerationItem, VideoGenerationItem } from '@superone/shared/agent-types'
import { ImageIcon } from 'lucide-react'
import { PortableNativeGallery } from './PortableNativeGallery'

export function PortableImageGallery({ items }: { items: ImageGenerationItem[] }) {
  const available = items.filter((item) => Boolean(item.savedPath))
  const unavailable = items.filter((item) => !item.savedPath)
  return (
    <>
      {available.length > 0 ? (
        <PortableNativeGallery
          payload={{
            kind: 'native',
            nativeType: 'image-gallery',
            title: available.some((item) => item.status === 'in_progress')
              ? 'Generating images…'
              : 'Generated images',
            images: available,
          }}
        />
      ) : null}
      {unavailable.length > 0 ? (
        <div className="my-2 grid grid-cols-2 gap-2" data-portable-image-placeholders>
          {unavailable.map((item) => (
            <button
              type="button"
              key={item.id}
              className="min-h-20 rounded-lg border border-border/60 bg-muted/25 p-2 text-left text-xs"
              disabled
            >
              <ImageIcon className="mb-2 size-5 text-muted-foreground" />
              <span className="block truncate font-medium">Generated image</span>
              <span className="block truncate text-muted-foreground">{item.revisedPrompt ?? item.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * Turn-end video cards. Only a finished video has a path to preview; an
 * in-flight one is represented by its still-visible submit tool row.
 */
export function PortableVideoGallery({ items }: { items: VideoGenerationItem[] }) {
  const available = items.filter((item) => Boolean(item.savedPath))
  if (available.length === 0) return null
  return (
    <PortableNativeGallery
      payload={{ kind: 'native', nativeType: 'video-gallery', title: 'Generated videos', videos: available }}
    />
  )
}

