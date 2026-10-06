import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@superone/ui/components/ui/dialog'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { AlertCircle, Check, Copy, Maximize2, RotateCw, X } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { tryCopyImage } from '@/lib/clipboard'
import { PdfPreview } from './PdfPreview'
import { ChipHoverCard } from './ChipHoverCard'
import { ImageLightbox } from './image-lightbox'
import { MentionChipContent } from './MentionChip'
import { useCopyFeedback } from './chat-message/copy-button'
import type { AttachmentOriginalStatus, ImageAttachment } from '@superone/shared/agent-types'

/**
 * Inline attachment chip: an image thumbnail or a file-type icon, then the file
 * name. Shared by the sent-message renderer and the composer's editor node.
 * Click opens the image viewer (PDF: its preview); hover shows the image larger
 * with copy / open. `selectable` lets a sent bubble's selection take the chip.
 */
/**
 * A composer chip's full-size original on its way to a remote node. Send waits for it; a failed
 * upload is retried, or the attachment removed and added again.
 */
export interface AttachmentOriginalUpload {
  status: AttachmentOriginalStatus | undefined
  onRetry: () => void
}

export function AttachmentChip({ att, selectable, original }: { att: ImageAttachment; selectable?: boolean; original?: AttachmentOriginalUpload }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { copied, run } = useCopyFeedback()
  const isPdf = att.mimeType === 'application/pdf'
  const src = `data:${att.mimeType};base64,${att.base64}`
  const upload = original?.status
  const uploading = upload?.state === 'uploading'
  const failed = upload?.state === 'failed'
  const uploadNote = uploading ? t('chat.attachmentOriginal.uploading', { percent: Math.round(upload.progress * 100) })
    : failed ? t(upload.retryable ? 'chat.attachmentOriginal.failed' : 'chat.attachmentOriginal.failedReattach') : null
  return (
    <>
      <ChipHoverCard
        title={att.name}
        actions={(
          <>
            {failed && upload.retryable && (
              <IconButton tooltip={t('chat.attachmentOriginal.retry')} onClick={original!.onRetry}>
                <RotateCw />
              </IconButton>
            )}
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
        card={isPdf ? undefined : (
          <>
            <img src={src} alt={att.name} className="max-h-64 w-full rounded-md object-contain" />
            {uploadNote && <p className={cn('mt-1.5 text-xs', failed ? 'text-error' : 'text-muted-foreground')}>{uploadNote}</p>}
          </>
        )}
      >
        <MentionChipContent
          role="button"
          kind="attachment"
          className={cn('break-normal cursor-pointer', selectable && 'select-text')}
          aria-description={uploadNote ?? undefined}
          // Copied as a separator plus, in the HTML flavour, the image in place
          // (utils/selection-copy.ts); its name as text would duplicate it on paste.
          data-copy-text=" "
          data-copy-image={isPdf ? undefined : ''}
          onClick={() => setOpen(true)}
          icon={isPdf
            ? <FileIcon name={att.name} size={16} />
            : uploading ? <UploadThumbnail src={src} alt={att.name} progress={upload.progress} />
            : failed ? <AlertCircle className="text-error" />
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

const RING_RADIUS = 5.5
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

/**
 * The thumbnail, dimmed, with the upload's progress ring over it. Progress moves a chunk at a time,
 * so until the first chunk lands a short arc spins instead of a ring stuck at zero.
 */
function UploadThumbnail({ src, alt, progress }: { src: string; alt: string; progress: number }) {
  const started = progress > 0
  return (
    <span className="relative" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <img src={src} alt={alt} className="absolute inset-0 size-full rounded-[2px] brightness-50" style={{ objectFit: 'cover' }} />
      <svg viewBox="0 0 16 16" className={cn('absolute inset-0 size-full -rotate-90', !started && 'animate-spin')} aria-hidden="true">
        <circle cx="8" cy="8" r={RING_RADIUS} fill="none" stroke="white" strokeOpacity={0.35} strokeWidth={2.5} />
        <circle
          cx="8" cy="8" r={RING_RADIUS} fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - (started ? progress : 0.25))}
          className="transition-[stroke-dashoffset] duration-300"
        />
      </svg>
    </span>
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
