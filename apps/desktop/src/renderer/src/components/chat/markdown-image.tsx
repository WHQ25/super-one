import { useState, type ComponentProps } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { toMediaUrl } from '@/lib/path-utils'
import { ImageInteractive, useImageMenuItems } from './image-shared'

const isWindows = window.app.platform === 'win32'

const MEDIA_STYLE = { maxHeight: '20rem', maxWidth: '100%', width: 'auto', height: 'auto', borderRadius: '8px', display: 'block' } as const

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
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
        <AdaptiveContextMenu items={menuItems}>
            <div className="absolute inset-0 px-[5vw] py-[5vh]">
              <ImagePreview src={src} alt={alt || 'Image'} />
            </div>
        </AdaptiveContextMenu>

        <Button
          variant="ghost"
          size="icon-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            "absolute right-[60px] z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
            isWindows ? "top-12" : "top-3"
          )}
           onClick={handleDownload}
          disabled={downloading}
          aria-label="Download image"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </Button>

        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              "absolute right-3 z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
              isWindows ? "top-12" : "top-3"
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>

        {downloadStatus && (
          <div className={cn(
            "absolute right-3 z-20 max-w-70 truncate rounded-md border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
            isWindows ? "top-[84px]" : "top-14"
          )}>
            {downloadStatus}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function MarkdownImage(props: ComponentProps<'img'>) {
  const [open, setOpen] = useState(false)
  const savedPath = srcToLocalPath(props.src)
  const mediaSrc = savedPath ? toMediaUrl(savedPath) : props.src
  const alt = props.alt ?? ''

  if (!savedPath || !mediaSrc) {
    return <img {...props} src={mediaSrc} style={MEDIA_STYLE} />
  }

  return (
    <>
      <ImageInteractive
        savedPath={savedPath}
        onOpen={() => setOpen(true)}
        ariaLabel={alt || 'Image'}
        className="inline-block max-w-full cursor-pointer border-0 bg-transparent p-0 align-top"
      >
        <img {...props} src={mediaSrc} alt={alt} draggable={false} crossOrigin="anonymous" style={MEDIA_STYLE} />
      </ImageInteractive>
      <MarkdownImageLightbox
        src={mediaSrc}
        alt={alt}
        savedPath={savedPath}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
