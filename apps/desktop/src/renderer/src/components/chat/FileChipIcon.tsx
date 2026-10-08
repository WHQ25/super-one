import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import { IMAGE_EXTENSIONS } from '@superone/shared/file-preview'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'
import { resolveMediaSrcForProject } from '@/lib/remote-media-url'
import { toLocalFileUrl } from '@/lib/path-utils'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { ChipHoverCard } from '@superone/ui/components/ui/ChipHoverCard'
import { ImageLightbox } from './image-lightbox'

/** Image art lives inside the existing file drag handle; the image itself never drags. */
export function FileChipIcon({ name, filePath, size = 16 }: { name: string; filePath?: string; size?: number }) {
  const iconName = filePath?.split(/[/\\]/).pop() || name
  const ext = /\.[^.]+$/.exec(iconName)?.[0].toLowerCase()
  if (!filePath || !ext || !IMAGE_EXTENSIONS.has(ext)) return <FileIcon name={iconName} size={size} />
  return <FileImageIcon key={filePath} name={name} filePath={filePath} size={size} />
}

function FileImageIcon({ name, filePath, size }: { name: string; filePath: string; size: number }) {
  const { t } = useTranslation()
  const projectRoot = useAppStore(selectEffectiveProjectRoot)
  const src = projectRoot ? resolveMediaSrcForProject(filePath, projectRoot) : toLocalFileUrl(filePath)
  const { displaySrc, failed } = useResolvedMediaSrc(src)
  const [brokenSrc, setBrokenSrc] = useState<string>()
  const [hover, setHover] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [open, setOpen] = useState(false)
  if (!displaySrc || failed || brokenSrc === displaySrc) return <FileIcon name={filePath.split(/[/\\]/).pop() || name} size={size} />
  const enlarge = () => { setHover(false); setOpen(true) }
  return (
    <span
      className="inline-flex size-full items-center justify-center"
      style={{ width: size, height: size }}
      onMouseDownCapture={(e) => {
        // React portal events bubble here too; keep the preview mounted until its click.
        if (!e.currentTarget.contains(e.target as Node)) return
        setPressed(true)
        setHover(false)
      }}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onDragStartCapture={() => { setPressed(true); setHover(false) }}
    >
      <ChipHoverCard
        open={hover && !pressed && !open}
        onOpenChange={(next) => setHover(next && !pressed && !open)}
        title={name}
        actions={<IconButton tooltip={t('chat.attachmentChip.open')} onClick={(e) => { e.stopPropagation(); enlarge() }}><Maximize2 /></IconButton>}
        card={(
          <button type="button" className="block w-full cursor-zoom-in" aria-label={t('chat.attachmentChip.open')}
            onClick={(e) => { e.stopPropagation(); enlarge() }}>
            <img src={displaySrc} alt={name} draggable={false} className="max-h-64 w-full rounded-md object-contain" />
          </button>
        )}
      >
        <img src={displaySrc} alt="" draggable={false} crossOrigin="anonymous" data-file-thumbnail="" width={size} height={size}
          className="block size-full rounded-[2px] object-cover" loading="lazy" onError={() => setBrokenSrc(displaySrc)} />
      </ChipHoverCard>
      {/* Portal events still bubble through the chip: viewer clicks must not open FileTab. */}
      {open && <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <ImageLightbox src={displaySrc} alt={name} open={open} onOpenChange={setOpen} />
      </span>}
    </span>
  )
}
