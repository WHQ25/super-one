import { useState, type ComponentProps } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { toMediaUrl } from '@/lib/path-utils'
import { isRemoteMediaUrl } from '@/lib/remote-media-url'
import { useResolvedMediaSrc } from '@/hooks/use-resolved-media-src'
import { ImageInteractive, useImageMenuItems } from './image-shared'
import { mediaStyleFor } from './markdown-media-style'
import { ImageLightbox, lightboxButtonClass } from './image-lightbox'

const isWindows = window.app.platform === 'win32'

/**
 * An image wrapped in a link belongs to the link — GitHub navigates, it does
 * not zoom. Opening the lightbox as well would stack our viewer on top of
 * whatever the anchor already does (the external-link prompt), so the click is
 * left to bubble to the anchor untouched.
 */
function insideLink(el: EventTarget | null): boolean {
  return el instanceof Element && el.closest('a[href]') !== null
}

function srcToLocalPath(src: string | undefined): string | null {
  if (!src || !src.startsWith('local-file:///')) return null
  try {
    return decodeURIComponent(new URL(src).pathname)
  } catch {
    return null
  }
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

interface LightboxProps {
  src: string
  alt: string
  savedPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function MarkdownImageLightbox({ src, alt, savedPath, open, onOpenChange }: LightboxProps) {
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const menuItems = useImageMenuItems({ savedPath })

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setDownloadStatus(null)
    try {
      const res = await window.app.saveFileAs(savedPath, basename(savedPath))
      if (res.ok) setDownloadStatus(`Saved to ${res.savedPath}`)
      else if (!res.canceled) setDownloadStatus(`Failed: ${res.error ?? 'unknown error'}`)
      setDownloading(false)
    } catch (e) {
      setDownloading(false)
      throw e
    }
  }

  return (
    <ImageLightbox src={src} alt={alt} open={open} onOpenChange={onOpenChange} menuItems={menuItems}>
      <Button
        variant="ghost"
        size="icon-xs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={lightboxButtonClass('second')}
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download image"
      >
        {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      </Button>
      {downloadStatus && (
        <div className={cn(
          "absolute right-3 z-20 max-w-70 truncate rounded-md border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
          isWindows ? "top-[84px]" : "top-14"
        )}>
          {downloadStatus}
        </div>
      )}
    </ImageLightbox>
  )
}

export function MarkdownImage(props: ComponentProps<'img'>) {
  const [open, setOpen] = useState(false)
  const savedPath = srcToLocalPath(props.src)
  const { displaySrc, loading, failed } = useResolvedMediaSrc(props.src)
  const alt = props.alt ?? ''
  const mediaStyle = mediaStyleFor(props.width, props.height)
  // An authored size means the image is meant to sit in a line of text, so the
  // wrapper shares that baseline instead of topping out the line box.
  const wrapperClass = cn(
    'max-w-full cursor-pointer border-0 bg-transparent p-0',
    mediaStyle.display === 'block' ? 'inline-block align-top' : 'inline align-middle',
  )
  const openLightbox = (e: React.MouseEvent) => {
    if (insideLink(e.currentTarget)) return
    setOpen(true)
  }

  // Local file path for context menu / download when available.
  const localPath = savedPath
  const mediaSrc =
    displaySrc ?? (savedPath ? toMediaUrl(savedPath) : props.src && !isRemoteMediaUrl(props.src) ? props.src : undefined)

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading image…
      </span>
    )
  }

  if (failed || !mediaSrc) {
    return <span className="text-xs text-muted-foreground">{alt || 'Image unavailable'}</span>
  }

  // Remote data: URI — preview + lightbox without host path download.
  if (!localPath) {
    return (
      <>
        <button
          type="button"
          onClick={openLightbox}
          className={wrapperClass}
          aria-label={alt || 'Image'}
        >
          <img {...props} src={mediaSrc} alt={alt} draggable={false} style={mediaStyle} />
        </button>
        <ImageLightbox src={mediaSrc} alt={alt} open={open} onOpenChange={setOpen} />
      </>
    )
  }

  return (
    <>
      <ImageInteractive
        savedPath={localPath}
        onOpen={openLightbox}
        ariaLabel={alt || 'Image'}
        className={wrapperClass}
      >
        <img {...props} src={mediaSrc} alt={alt} draggable={false} crossOrigin="anonymous" style={mediaStyle} />
      </ImageInteractive>
      <MarkdownImageLightbox
        src={mediaSrc}
        alt={alt}
        savedPath={localPath}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
