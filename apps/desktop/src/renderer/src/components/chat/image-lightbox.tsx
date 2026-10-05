import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { AdaptiveContextMenu } from '@/components/AdaptiveContextMenu'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { ImagePreview } from '@/components/coding/ImagePreview'

const isWindows = window.app.platform === 'win32'

/** Round floating button in the lightbox corner; `offset` stacks extra ones left of Close. */
export function lightboxButtonClass(offset: 'close' | 'second'): string {
  return cn(
    'absolute z-20 size-9 rounded-full border border-border/50 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground',
    offset === 'close' ? 'right-3' : 'right-[60px]',
    isWindows ? 'top-12' : 'top-3',
  )
}

/**
 * Full-window image viewer with zoom and pan, shared by chat images (markdown,
 * attachments). `menuItems` add a context menu on the image; `children` add
 * floating controls next to Close.
 */
export function ImageLightbox({ src, alt, open, onOpenChange, menuItems, children }: {
  src: string
  alt: string
  open: boolean
  onOpenChange: (open: boolean) => void
  menuItems?: AdaptiveMenuEntry[]
  children?: ReactNode
}) {
  const preview = (
    <div className="absolute inset-0 px-[5vw] py-[5vh]">
      <ImagePreview src={src} alt={alt || 'Image'} />
    </div>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        showCloseButton={false}
        className="left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none sm:max-w-none"
      >
        <DialogTitle className="sr-only">{alt || 'Image'}</DialogTitle>
        {menuItems ? <AdaptiveContextMenu items={menuItems}>{preview}</AdaptiveContextMenu> : preview}
        {children}
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
      </DialogContent>
    </Dialog>
  )
}
