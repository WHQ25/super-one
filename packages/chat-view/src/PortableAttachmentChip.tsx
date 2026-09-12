import { FileText, ImageIcon } from 'lucide-react'
import type { ChatMessage, ContentBlock, ImageAttachment } from '@superone/shared/agent-types'
import { previewImage } from './image-preview'

type AttachmentBlock = Extract<ContentBlock, { type: 'image' | 'document' }>

/**
 * The attachment a user-bubble block stands for. Matched the way desktop's
 * `ChatMessage` does — by `id` when the block carries one, by name otherwise —
 * so a bubble painted on the phone and one loaded from the host resolve alike.
 */
export function attachmentForBlock(message: Pick<ChatMessage, 'attachments'>, block: AttachmentBlock): ImageAttachment | undefined {
  return message.attachments?.find((item) => (block.id ? item.id === block.id : item.name === block.name))
}

/**
 * The phone's counterpart to desktop's `AttachmentChip`: a thumbnail (or a
 * file-type icon) beside the file name inside the user bubble. The thumbnail is
 * a touch target and opens the native viewer. A picture without bytes — the
 * host's stripped echo, or history whose bytes were dropped — falls back to
 * the icon rather than a broken image; a PDF has no bitmap to show at all.
 */
export function PortableAttachmentChip({ block, attachment }: { block: AttachmentBlock; attachment?: ImageAttachment }) {
  const src = attachment?.base64 && block.type === 'image'
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : null
  const label = attachment?.name ?? block.name
  const icon = block.type === 'document' ? <FileText className="size-4" /> : <ImageIcon className="size-4" />
  return (
    <div
      data-attachment-chip={block.type}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/60 py-1 pl-1 pr-2 text-xs"
    >
      {src
        ? (
          <button
            type="button"
            className="shrink-0 overflow-hidden rounded-sm"
            onClick={() => previewImage(src, { label })}
            aria-label={`Preview ${label}`}
          >
            <img src={src} alt={label} className="size-10 object-cover" />
          </button>
        )
        : <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted/40 text-muted-foreground">{icon}</span>}
      <span className="truncate">{label}</span>
    </div>
  )
}
