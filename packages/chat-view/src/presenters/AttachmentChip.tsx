import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, Copy, ImageIcon, Maximize2, RotateCw } from 'lucide-react'
import type { AttachmentOriginalStatus, ImageAttachment } from '@superone/shared/agent-types'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { MentionChipContent } from '@superone/ui/components/ui/MentionChipBody'
import { cn } from '@superone/ui/lib/utils'
import { useCopiedFlag } from './PasteChip'
import { useUserBubblePorts } from './user-bubble-ports'

/**
 * A composer chip's full-size original on its way to a remote node. Send waits for it; a failed
 * upload is retried, or the attachment removed and added again.
 */
export interface AttachmentOriginalUpload {
  status: AttachmentOriginalStatus | undefined
  onRetry: () => void
}

/**
 * Inline attachment chip: an image thumbnail or a file-type icon, then the file
 * name, in the composer and in a sent bubble on both hosts. Click or tap opens
 * the host's viewer; where the host has hover, a card shows the image larger
 * with copy / open. `selectable` lets a sent bubble's selection take the chip.
 * `messageId` lets a host fetch an original the transcript only holds a
 * thumbnail of.
 */
export function AttachmentChipPresenter({ att, document, messageId, selectable, original }: {
  att: ImageAttachment
  /** A document block: its bytes may be gone (a phone transcript), so its mime type cannot say. */
  document?: boolean
  messageId?: string
  selectable?: boolean
  original?: AttachmentOriginalUpload
}) {
  const { t } = useTranslation()
  const { ChipCard, AttachmentViewer, copyImage } = useUserBubblePorts()
  const [open, setOpen] = useState(false)
  const { copied, run } = useCopiedFlag()
  const isPdf = document || att.mimeType === 'application/pdf'
  // A picture can arrive without bytes (the host could not cut a thumbnail):
  // its icon stands in, and opening still fetches the original.
  const src = att.base64 ? `data:${att.mimeType};base64,${att.base64}` : null
  const upload = original?.status
  const uploading = upload?.state === 'uploading'
  const failed = upload?.state === 'failed'
  const uploadNote = uploading ? t('chat.attachmentOriginal.uploading', { percent: Math.round(upload.progress * 100) })
    : failed ? t(upload.retryable ? 'chat.attachmentOriginal.failed' : 'chat.attachmentOriginal.failedReattach') : null
  return (
    <>
      <ChipCard
        title={att.name}
        actions={(
          <>
            {failed && upload.retryable && (
              <IconButton tooltip={t('chat.attachmentOriginal.retry')} onClick={original!.onRetry}>
                <RotateCw />
              </IconButton>
            )}
            {!isPdf && copyImage && (
              <IconButton tooltip={t('chat.image.copyImage')} onClick={() => void run(() => copyImage(att))}>
                {copied ? <Check className="text-success" /> : <Copy />}
              </IconButton>
            )}
            <IconButton tooltip={t('chat.attachmentChip.open')} onClick={() => setOpen(true)}>
              <Maximize2 />
            </IconButton>
          </>
        )}
        card={isPdf || !src ? undefined : (
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
          // Copied as a separator plus, in the HTML flavour, the image in place;
          // its name as text would duplicate it on paste.
          data-copy-text=" "
          data-copy-image={isPdf ? undefined : ''}
          onClick={() => setOpen(true)}
          icon={isPdf
            ? <FileIcon name={att.name} size={16} />
            : !src ? <ImageIcon />
            : uploading ? <UploadThumbnail src={src} alt={att.name} progress={upload.progress} />
            : failed ? <AlertCircle className="text-error" />
            // Inline style: .mention-chip__icon > img forces object-fit: contain.
            : <img src={src} alt={att.name} className="rounded-[2px]" style={{ objectFit: 'cover' }} />}
          label={att.name}
        />
      </ChipCard>
      <AttachmentViewer attachment={att} isDocument={isPdf} messageId={messageId} open={open} onOpenChange={setOpen} />
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
