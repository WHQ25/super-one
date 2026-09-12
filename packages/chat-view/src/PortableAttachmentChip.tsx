import { useState } from 'react'
import { FileText, ImageIcon, Loader2 } from 'lucide-react'
import type { ChatMessage, ContentBlock, ImageAttachment } from '@superone/shared/agent-types'
import { requestNativeAsync } from './bridge'
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
 * The picture to open for an attachment. A transcript loaded from the host
 * carries only a thumbnail (`preview`), so the original is fetched through the
 * `loadAttachment` native action; a bubble the phone painted itself already
 * holds the bytes.
 */
export async function attachmentImageSource(messageId: string, attachment: ImageAttachment): Promise<string> {
  if (!attachment.preview) return `data:${attachment.mimeType};base64,${attachment.base64}`
  const result = await requestNativeAsync('loadAttachment', {
    messageId, name: attachment.name, ...(attachment.id ? { attachmentId: attachment.id } : {}),
  }) as { dataUri?: unknown } | null
  if (typeof result?.dataUri !== 'string') throw new Error('attachment unavailable')
  return result.dataUri
}

/**
 * The phone's counterpart to desktop's `AttachmentChip`: a thumbnail (or a
 * file-type icon) beside the file name inside the user bubble. The thumbnail is
 * a touch target and opens the native viewer with the original. A picture
 * without bytes — a thumbnail the host could not cut, the host's stripped
 * echo — falls back to the icon rather than a broken image; a PDF has no
 * bitmap to show at all.
 */
export function PortableAttachmentChip({ messageId, block, attachment }: { messageId: string; block: AttachmentBlock; attachment?: ImageAttachment }) {
  const [loading, setLoading] = useState(false)
  const isPicture = block.type === 'image' && Boolean(attachment)
  const thumbnail = isPicture && attachment?.base64
    ? `data:${attachment.mimeType};base64,${attachment.base64}`
    : null
  const label = attachment?.name ?? block.name
  const icon = block.type === 'document' ? <FileText className="size-4" /> : <ImageIcon className="size-4" />
  const open = async () => {
    if (!attachment || loading) return
    setLoading(true)
    try {
      previewImage(await attachmentImageSource(messageId, attachment), { label })
    } catch {
      // The host no longer has it (or is too old to answer): the chip stays as it is.
    } finally {
      setLoading(false)
    }
  }
  const picture = thumbnail
    ? <img src={thumbnail} alt={label} className="size-10 object-cover" />
    : <span className="flex size-10 items-center justify-center bg-muted/40 text-muted-foreground">{icon}</span>
  return (
    <div
      data-attachment-chip={block.type}
      data-attachment-loading={loading || undefined}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/60 py-1 pl-1 pr-2 text-xs"
    >
      {isPicture
        ? (
          <button
            type="button"
            className="relative shrink-0 overflow-hidden rounded-sm"
            onClick={() => { void open() }}
            aria-label={`Preview ${label}`}
            aria-busy={loading || undefined}
          >
            {picture}
            {loading && (
              <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-4 animate-spin" />
              </span>
            )}
          </button>
        )
        : <span className="shrink-0 overflow-hidden rounded-sm">{picture}</span>}
      <span className="truncate">{label}</span>
    </div>
  )
}
