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
 * An attachment inside the user bubble. A picture is just its thumbnail — a
 * 64 px square that opens the native viewer with the original; the file name
 * says nothing a phone user wants to read. A PDF keeps an icon chip with its
 * name, which is all it has. A picture without bytes (a thumbnail the host
 * could not cut, the host's stripped echo) shows the icon in the same square,
 * and the tap still fetches the original.
 */
export function PortableAttachmentChip({ messageId, block, attachment }: { messageId: string; block: AttachmentBlock; attachment?: ImageAttachment }) {
  const [loading, setLoading] = useState(false)
  const label = attachment?.name ?? block.name
  const open = async () => {
    if (!attachment || loading) return
    setLoading(true)
    try {
      previewImage(await attachmentImageSource(messageId, attachment), { label })
    } catch {
      // The host no longer has it (or is too old to answer): the tile stays as it is.
    } finally {
      setLoading(false)
    }
  }
  if (block.type === 'document') {
    return (
      <div
        data-attachment-chip="document"
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </div>
    )
  }
  const thumbnail = attachment?.base64 ? `data:${attachment.mimeType};base64,${attachment.base64}` : null
  return (
    <button
      type="button"
      data-attachment-chip="image"
      data-attachment-loading={loading || undefined}
      className="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40"
      onClick={() => { void open() }}
      aria-label={`Preview ${label}`}
      aria-busy={loading || undefined}
      disabled={!attachment}
    >
      {thumbnail
        ? <img src={thumbnail} alt={label} className="size-full object-cover" />
        : <span className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-5" /></span>}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2 className="size-4 animate-spin" />
        </span>
      )}
    </button>
  )
}
