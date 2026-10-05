import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { Check, Copy, Maximize2, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { tryCopyImage } from '@/lib/clipboard'
import { PdfPreview } from './PdfPreview'
import { ChipHoverCard } from './ChipHoverCard'
import { ImageLightbox } from './image-lightbox'
import { MentionChipContent } from './MentionChip'
import { useCopyFeedback } from './chat-message/copy-button'
import type { ImageAttachment } from '@superone/shared/agent-types'

/**
 * Inline attachment chip: an image thumbnail or a file-type icon, then the file
 * name. Shared by the sent-message renderer and the composer's editor node.
 * Click opens the image viewer (PDF: its preview); hover shows the image larger
 * with copy / open. `selectable` lets a sent bubble's selection take the chip.
 */
export function AttachmentChip({ att, selectable }: { att: ImageAttachment; selectable?: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { copied, run } = useCopyFeedback()
  const isPdf = att.mimeType === 'application/pdf'
  const src = `data:${att.mimeType};base64,${att.base64}`
  return (
    <>
      <ChipHoverCard
        title={att.name}
        actions={(
          <>
            {!isPdf && (
              <IconButton tooltip={t('chat.image.copyImage')} onClick={() => void run(() => tryCopyImage(att.mimeType, att.base64))}>
                {copied ? <Check className="text-success" /> : <Copy />}
              </IconButton>
            )}
            <IconButton tooltip={t('chat.attachmentChip.open')} onClick={() => setOpen(true)}>
              <Maximize2 />
            </IconButton>
          </>
        )}
        card={isPdf ? undefined : <img src={src} alt={att.name} className="max-h-64 w-full rounded-md object-contain" />}
      >
        <MentionChipContent
          role="button"
          kind="attachment"
          className={cn('break-normal cursor-pointer', selectable && 'select-text')}
          // Copied as a separator plus, in the HTML flavour, the image in place
          // (utils/selection-copy.ts); its name as text would duplicate it on paste.
          data-copy-text=" "
          data-copy-image={isPdf ? undefined : ''}
          onClick={() => setOpen(true)}
          icon={isPdf
            ? <FileIcon name={att.name} size={16} />
            // Inline style: .mention-chip__icon > img forces object-fit: contain.
            : <img src={src} alt={att.name} className="rounded-[2px]" style={{ objectFit: 'cover' }} />}
          label={att.name}
        />
      </ChipHoverCard>
      {isPdf
        ? open && <AttachmentPreviewDialog attachment={att} onClose={() => setOpen(false)} />
        : <ImageLightbox src={src} alt={att.name} open={open} onOpenChange={setOpen} />}
    </>
  )
}

/** Full-size preview dialog for a PDF attachment. */
function AttachmentPreviewDialog({ attachment, onClose }: { attachment: ImageAttachment; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <DialogTitle className="truncate text-sm font-medium">{attachment.name}</DialogTitle>
          <DialogClose asChild>
            <IconButton size="sm">
              <X />
            </IconButton>
          </DialogClose>
        </div>
        <PdfPreview base64={attachment.base64} />
      </DialogContent>
    </Dialog>
  )
}
