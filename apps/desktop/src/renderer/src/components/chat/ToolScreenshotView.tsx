import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { cn } from '@superone/ui/lib/utils'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { ImagePreview } from '@/components/coding/ImagePreview'
import {
  ImageInteractive,
  useImageDataUri,
  useImageMenuItems,
} from './image-shared'

const isWindows = window.app.platform === 'win32'

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

interface ToolScreenshotViewProps {
  path: string
  label: string
  unavailableLabel: string
}

export function ToolScreenshotView({
  path,
  label,
  unavailableLabel,
}: ToolScreenshotViewProps) {
  const { t } = useTranslation()
  const { dataUri, loadError } = useImageDataUri(path, false)
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const menuItems = useImageMenuItems({ savedPath: path, downloadable: true })

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    setDownloadStatus(null)
    try {
      const result = await window.app.saveFileAs(path, basename(path))
      if (result.ok) setDownloadStatus(`Saved to ${result.savedPath}`)
      else if (!result.canceled)
        setDownloadStatus(`Failed: ${result.error ?? 'unknown error'}`)
    } finally {
      setDownloading(false)
    }
  }

  if (loadError) {
    return (
      <div className="text-xs italic text-muted-foreground/60">
        {unavailableLabel}
      </div>
    )
  }
  if (!dataUri) return null

  return (
    <>
      <ImageInteractive
        savedPath={path}
        onOpen={() => setOpen(true)}
        downloadable
        ariaLabel={label}
        className="block max-w-full cursor-zoom-in"
      >
        <img
          src={dataUri}
          alt={label}
          className="mx-auto block max-h-80 w-auto max-w-full object-contain"
        />
      </ImageInteractive>

      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <AdaptiveContextMenu items={menuItems}>
            <div className="absolute inset-0 px-[5vw] py-[5vh]">
              <ImagePreview src={dataUri} alt={label} />
            </div>
          </AdaptiveContextMenu>

          <Button
            variant="ghost"
            size="icon"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'absolute right-[60px] z-20 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
              isWindows ? 'top-12' : 'top-3',
            )}
            onClick={handleDownload}
            disabled={downloading}
            aria-label={t('chat.image.download')}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>

          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={cn(
                'absolute right-3 z-20 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
                isWindows ? 'top-12' : 'top-3',
              )}
              aria-label={t('common.close')}
            >
              <X />
            </Button>
          </DialogClose>

          {downloadStatus && (
            <div
              className={cn(
                'absolute right-3 z-20 max-w-70 truncate rounded-md border border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm',
                isWindows ? 'top-[84px]' : 'top-14',
              )}
            >
              {downloadStatus}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
