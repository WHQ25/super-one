import { useEffect, useState } from 'react'
import { ImageIcon, Video } from 'lucide-react'
import { loadHostImage, PortableHostImage } from './PortableHostImage'
import { PortableHostVideo, useHostVideoPoster } from './PortableHostVideo'
import { generationInfo } from './PortableNativeGallery'
import { portableFileName } from './portable-native-widget'
import { GeneratedMediaGallery, GeneratedMediaPlaceholder } from './presenters/GeneratedMediaGallery'
import type { GeneratedMediaItem } from './presenters/tool-display'

const PREVIEW_FALLBACK = 'flex min-h-24 w-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-primary'

function ImageThumbnail({ path, root }: { path: string; root?: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let active = true
    void loadHostImage(root, path, false).then(phase => {
      if (active) setSrc(phase.kind === 'ready' ? phase.dataUri : undefined)
    })
    return () => { active = false }
  }, [path, root])

  return src
    ? <img src={src} alt="" className="size-full object-cover" onError={() => setSrc(undefined)} />
    : <ImageIcon aria-hidden className="size-4" />
}

function VideoThumbnail({ path, root }: { path: string; root?: string }) {
  const phase = useHostVideoPoster(root, path)
  return phase.kind === 'ready'
    ? <img src={phase.poster.dataUri} alt="" className="size-full object-cover" />
    : <Video aria-hidden className="size-4" />
}

export function PortableGeneratedMediaGallery({ items, projectPath }: {
  items: GeneratedMediaItem[]
  projectPath?: string | null
}) {
  const root = projectPath ?? undefined
  return (
    <GeneratedMediaGallery
      items={items}
      renderPreview={(item) => {
        if (item.status === 'failed') return <GeneratedMediaPlaceholder pending={false} />
        const path = item.savedPath
        if (!path) return <GeneratedMediaPlaceholder pending />
        const label = portableFileName(path)
        return item.type === 'image_generation' ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <PortableHostImage
              path={path}
              root={root}
              label={label}
              className={PREVIEW_FALLBACK}
              pictureClassName="min-h-0 flex-1 overflow-hidden rounded-lg"
              imageClassName="block size-full object-contain"
              generation={generationInfo(item)}
            />
          </div>
        ) : (
          <PortableHostVideo
            path={path}
            root={root}
            label={label}
            className={PREVIEW_FALLBACK + ' flex-1'}
            tileClassName="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg bg-black"
            imageClassName="block size-full object-contain"
          />
        )
      }}
      renderThumbnail={item => {
        if (item.status === 'failed') return null
        if (item.type === 'video_generation') {
          return item.savedPath && <VideoThumbnail key={item.savedPath} path={item.savedPath} root={root} />
        }
        const path = item.previewPath ?? item.savedPath
        return path && <ImageThumbnail key={path} path={path} root={root} />
      }}
    />
  )
}
