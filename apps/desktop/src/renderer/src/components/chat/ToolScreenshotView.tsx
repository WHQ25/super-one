import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, MessageSquarePlus, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { cn } from '@superone/ui/lib/utils'
import { ToolScreenshotViewPresenter } from '@superone/chat-view/presenters/ToolScreenshotView'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { chatInputAPI } from './chat-input-api'
import { ImageAnnotationEditor } from './image-editor/ImageAnnotationEditor'
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
  const [editing, setEditing] = useState(false)
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const menuItems = useImageMenuItems({ savedPath: path, downloadable: true })

  useEffect(() => {
    if (!open) setEditing(false)
  }, [open])

  useEffect(() => {
    setOverrideSrc(null)
  }, [path])

  const activeSrc = overrideSrc ?? dataUri

  const handleQuickAddToChat = useCallback(async () => {
    if (overrideSrc && overrideSrc.startsWith('data:') && chatInputAPI.addImageFromBase64) {
      const commaIdx = overrideSrc.indexOf(',')
      const base64 = commaIdx >= 0 ? overrideSrc.slice(commaIdx + 1) : ''
      if (base64) {
        await chatInputAPI.addImageFromBase64(base64, 'image/png', basename(path))
        toast.success(t('chat.imageEditor.addedToChat'))
        setOpen(false)
        return
      }
    }
    if (chatInputAPI.addImageFromPath) {
      await chatInputAPI.addImageFromPath(path)
      toast.success(t('chat.imageEditor.addedToChat'))
      setOpen(false)
    }
  }, [overrideSrc, path, t])

  useEffect(() => {
    if (!open || editing) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        void handleQuickAddToChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, editing, handleQuickAddToChat])

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
    return <ToolScreenshotViewPresenter path={path} label={label} unavailableLabel={unavailableLabel} unavailable />
  }
  if (!activeSrc) {
    return <ToolScreenshotViewPresenter path={path} label={label} unavailableLabel={unavailableLabel} loading />
  }

  return (
    <ToolScreenshotViewPresenter
      path={path}
      label={label}
      unavailableLabel={unavailableLabel}
      thumbnail={<ImageInteractive
        savedPath={path}
        onOpen={() => setOpen(true)}
        downloadable
        ariaLabel={label}
        className="block max-w-full cursor-zoom-in"
      >
        <img
          src={activeSrc}
          alt={label}
          className="mx-auto block max-h-80 w-auto max-w-full object-contain"
        />
      </ImageInteractive>}
      overlay={<Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          {editing ? (
            <ImageAnnotationEditor
              src={activeSrc}
              alt={label}
              filePath={path}
              fileName={basename(path)}
              onSavedImage={(dataUrl) => setOverrideSrc(dataUrl)}
              onExitEdit={() => setEditing(false)}
              onCloseViewer={() => setOpen(false)}
            />
          ) : (
            <>
              <AdaptiveContextMenu items={menuItems}>
                <div className="absolute inset-0 px-[5vw] py-[5vh]">
                  <ImagePreview src={activeSrc} alt={label} />
                </div>
              </AdaptiveContextMenu>

              <Button
                variant="ghost"
                size="icon"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={cn(
                  'absolute right-[156px] z-20 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
                  isWindows ? 'top-12' : 'top-3',
                )}
                onClick={() => void handleQuickAddToChat()}
                title={`${t('chat.image.addToChat')} (⌘↵)`}
                aria-label={t('chat.image.addToChat')}
              >
                <MessageSquarePlus />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={cn(
                  'absolute right-[108px] z-20 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
                  isWindows ? 'top-12' : 'top-3',
                )}
                onClick={() => setEditing(true)}
                title={t('chat.image.edit')}
                aria-label={t('chat.image.edit')}
                data-testid="tool-screenshot-edit-button"
              >
                <Pencil />
              </Button>

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
            </>
          )}
        </DialogContent>
      </Dialog>}
    />
  )
}

