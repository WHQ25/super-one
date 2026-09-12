import type { ReactNode } from 'react'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import type { NativeWidgetPayload } from '@superone/shared/generative-ui/native-widgets'
import { ExternalLink, ImageIcon, Video } from 'lucide-react'
import { requestNative } from './bridge'
import { portableFileName } from './portable-native-widget'
import { PortableHostImage } from './PortableHostImage'

/**
 * A fixed-height strip the picture sizes itself into, like the desktop
 * `ImageGalleryBlock` tile but a step taller: a phone shows one tile per row
 * more often than not, and the desktop's 160px reads small at arm's length.
 */
export const GALLERY_TILE = 'h-48 flex-none overflow-hidden rounded-md border border-border bg-muted/30'
const GALLERY_CHIP = `${GALLERY_TILE} flex w-40 flex-col items-center justify-center gap-1.5 p-2 text-center`

/** The generation facts the viewer's info panel shows; `undefined` when the item carries none. */
function generationInfo(item: ImageGenerationItem) {
  const { revisedPrompt, generationMs, params, referenceImagePaths, warnings } = item
  if (!revisedPrompt && generationMs === undefined && !params?.length && !referenceImagePaths?.length && !warnings?.length) return undefined
  return { revisedPrompt, generationMs, params, referenceImagePaths, warnings }
}

/** One generated-image thumbnail; the chip stands in until the bytes arrive. */
export function PortableGalleryImage({ item }: { item: ImageGenerationItem }) {
  const path = item.savedPath!
  const name = portableFileName(path)
  return (
    <PortableHostImage
      path={path}
      label={name}
      className={GALLERY_CHIP}
      pictureClassName={GALLERY_TILE}
      imageClassName="block h-48 w-auto object-contain"
      generation={generationInfo(item)}
      fallback={(
        <>
          <ImageIcon className="size-6 text-primary" />
          <span className="max-w-full truncate text-xs text-foreground">{name}</span>
          <span className="flex items-center gap-1 text-[11px] text-primary">
            Open image <ExternalLink className="size-3" />
          </span>
        </>
      )}
    />
  )
}

/** The header line above a gallery — mirrors the desktop block's muted caption. */
export function PortableGalleryHeader({ kind, children }: { kind: 'image' | 'video'; children: ReactNode }) {
  const Icon = kind === 'image' ? ImageIcon : Video
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/**
 * The gallery a `widget_show` native template or a turn-end media collection
 * renders into. Laid out like the desktop `ImageGalleryBlock` / `VideoGalleryBlock`:
 * no frame, a muted caption, and a row of fixed-height tiles that wraps.
 */
export function PortableNativeGallery(props: {
  payload: NativeWidgetPayload
  toolUseId?: string
}) {
  const { payload } = props
  const items = payload.nativeType === 'image-gallery' ? payload.images ?? [] : payload.videos ?? []
  const kind = payload.nativeType === 'image-gallery' ? 'image' : 'video'
  return (
    <div className="my-2" data-native-widget={payload.nativeType} data-tool-use-id={props.toolUseId}>
      <PortableGalleryHeader kind={kind}>{payload.title || `Generated ${kind}s`}</PortableGalleryHeader>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const path = item.savedPath!
          if (kind === 'image') return <PortableGalleryImage key={item.id || path} item={item as ImageGenerationItem} />
          return (
            <button
              key={item.id || path}
              type="button"
              className={GALLERY_CHIP}
              onClick={() => requestNative('previewFile', { path })}
            >
              <Video className="size-6 text-primary" />
              <span className="max-w-full truncate text-xs text-foreground">{portableFileName(path)}</span>
              <span className="flex items-center gap-1 text-[11px] text-primary">
                Open video <ExternalLink className="size-3" />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
