import type { JSONContent } from '@tiptap/core'
import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import type { CopiedMention } from '@/lib/clipboard'
import { plainTextToTiptapParagraphContent } from './plainTextToTiptapDoc'
import { mentionCopyText } from '../chat-message/user-copy-html'
import { userMessageParts } from '../chat-message/user-message-parts'

/** A piece of composer content: text, a mention, a paste chip, or an attachment chip by id. */
export type DraftPart = { text: string } | { mention: CopiedMention } | { paste: string } | { attachmentId: string }

/**
 * Composer inline content for parts in order. Sending wrote each mention as
 * ` @x `; that padding space is dropped so a message put back does not grow it.
 */
export function draftInlineContent(parts: DraftPart[]): JSONContent[] {
  const isMention = (part?: DraftPart) => !!part && 'mention' in part
  return parts.flatMap((part, index): JSONContent[] => {
    if ('mention' in part) return [{ type: 'mention', attrs: part.mention }]
    if ('paste' in part) return [{ type: 'pasteChip', attrs: { text: part.paste } }]
    if ('attachmentId' in part) return [{ type: 'attachment', attrs: { id: part.attachmentId } }]
    let text = part.text
    if (isMention(parts[index - 1])) text = text.replace(/^ /, '')
    if (isMention(parts[index + 1])) text = text.replace(/ $/, '')
    return plainTextToTiptapParagraphContent(text)
  })
}

/** A sent user message as a composer draft, its chips back where they were. */
export function messageDraft(message: ChatMessage): { text: string; doc: JSONContent; attachments: ImageAttachment[] } {
  const placed = new Set<ImageAttachment>()
  const attachments: ImageAttachment[] = []
  const withId = (attachment: ImageAttachment): string => {
    const restored = attachment.id ? attachment : { ...attachment, id: crypto.randomUUID() }
    placed.add(attachment)
    attachments.push(restored)
    return restored.id!
  }
  const parts = userMessageParts(message).map((part): DraftPart => ('attachment' in part ? { attachmentId: withId(part.attachment) } : part))
  // An attachment no content block points at still comes back, after the text.
  for (const attachment of message.attachments ?? []) {
    if (!placed.has(attachment)) parts.push({ attachmentId: withId(attachment) })
  }
  const text = parts.map((part) => {
    if ('mention' in part) return mentionCopyText(part.mention)
    if ('paste' in part) return part.paste
    return 'text' in part ? part.text : ''
  }).join('')
  return { text, doc: { type: 'doc', content: [{ type: 'paragraph', content: draftInlineContent(parts) }] }, attachments }
}
