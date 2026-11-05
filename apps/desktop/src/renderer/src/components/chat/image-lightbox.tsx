import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { ImagePreview } from '@/components/coding/ImagePreview'
import { chatInputAPI } from './chat-input-api'
import { ImageAnnotationEditor } from './image-editor/ImageAnnotationEditor'

const isWindows = window.app.platform === 'win32'

export type LightboxButtonOffset = 'close' | 'second' | 'third' | 'fourth'

const OFFSET_CLASS: Record<LightboxButtonOffset, string> = {
  close: 'right-3',
  second: 'right-[60px]',
  third: 'right-[108px]',
  fourth: 'right-[156px]',
}

/** Round floating button in the lightbox corner; `offset` stacks extra ones left of Close. */
export function lightboxButtonClass(offset: LightboxButtonOffset): string {
  return cn(
    'absolute z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
    OFFSET_CLASS[offset],
    isWindows ? 'top-12' : 'top-3',
  )
}

/**
 * Full-window image viewer with zoom, pan, and built-in annotation editor, shared
 * by chat images (markdown, attachments, file chips). `menuItems` add a context menu
 * on the image; `children` add floating controls next to Close.
 */
export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
  menuItems,
  children,
  filePath,
  fileName,
  initialEditing = false,
  onReplaceAttachment,
}: {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  menuItems?: AdaptiveMenuEntry[]
  children?: ReactNode
  /** Local file path when viewing an image file on disk. Enables Save in-place and ⌘↵ Add to Chat. */
  filePath?: string
  /** Suggested file name for Save As / Add to Chat. */
  fileName?: string
  /** When true, opens directly in annotation edit mode. */
  initialEditing?: boolean
  /** Provided when viewing a composer attachment; Save replaces the attachment in place. */
  onReplaceAttachment?: (base64: string, mimeType: string) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(initialEditing)
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEditing(initialEditing)
    } else {
      setEditing(false)
    }
  }, [open, initialEditing])

  useEffect(() => {
    setOverrideSrc(null)
  }, [src])

  const activeSrc = overrideSrc ?? src
  const canQuickAddFileToChat = Boolean(filePath && !onReplaceAttachment)

  const handleQuickAddToChat = useCallback(async () => {
    if (!filePath) return
    if (overrideSrc && overrideSrc.startsWith('data:') && chatInputAPI.addImageFromBase64) {
      const commaIdx = overrideSrc.indexOf(',')
      const base64 = commaIdx >= 0 ? overrideSrc.slice(commaIdx + 1) : ''
      if (base64) {
        const name = fileName || filePath.split(/[/\\]/).pop() || alt || 'image.png'
        await chatInputAPI.addImageFromBase64(base64, 'image/png', name)
        toast.success(t('chat.imageEditor.addedToChat'))
        onOpenChange(false)
        return
      }
    }
    if (chatInputAPI.addImageFromPath) {
      await chatInputAPI.addImageFromPath(filePath)
      toast.success(t('chat.imageEditor.addedToChat'))
      onOpenChange(false)
    }
  }, [filePath, overrideSrc, fileName, alt, t, onOpenChange])

  useEffect(() => {
    if (!open || editing || !canQuickAddFileToChat) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        void handleQuickAddToChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, editing, canQuickAddFileToChat, handleQuickAddToChat])

  const editOffset: LightboxButtonOffset = children ? 'third' : 'second'
  const addToChatOffset: LightboxButtonOffset = children ? 'fourth' : 'third'

  const preview = (
    <div className="absolute inset-0 px-[5vw] py-[5vh]">
      <ImagePreview src={activeSrc} alt={alt || 'Image'} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
        {editing ? (
          <ImageAnnotationEditor
            src={activeSrc}
            alt={alt || 'Image'}
            filePath={filePath}
            fileName={fileName}
            onReplaceAttachment={onReplaceAttachment}
            onSavedImage={(dataUrl) => setOverrideSrc(dataUrl)}
            onExitEdit={() => {
              setEditing(false)
              if (initialEditing) onOpenChange(false)
            }}
            onCloseViewer={() => onOpenChange(false)}
          />
        ) : (
          <>
            {menuItems ? <AdaptiveContextMenu items={menuItems}>{preview}</AdaptiveContextMenu> : preview}
            {children}
            {canQuickAddFileToChat && (
              <Button
                variant="ghost"
                size="icon-xs"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={lightboxButtonClass(addToChatOffset)}
                onClick={() => void handleQuickAddToChat()}
                title={`${t('chat.image.addToChat')} (⌘↵)`}
                aria-label={t('chat.image.addToChat')}
                data-testid="image-lightbox-add-to-chat-button"
              >
                <MessageSquarePlus className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={lightboxButtonClass(editOffset)}
              onClick={() => setEditing(true)}
              title={t('chat.image.edit')}
              aria-label={t('chat.image.edit')}
              data-testid="image-lightbox-edit-button"
            >
              <Pencil className="size-4" />
            </Button>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={lightboxButtonClass('close')}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

