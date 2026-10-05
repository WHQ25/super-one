import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import type { CopiedMention } from '@/lib/clipboard'
import { parseUserMentions } from '../user-mention-parser'

/** A sent user message as the composer held it: text, mentions, paste chips and attachments. */
export type UserMessagePart =
  | { text: string }
  | { mention: CopiedMention }
  | { paste: string }
  | { attachment: ImageAttachment }

/** The stored attachment an image/document block refers to. */
export function attachmentForBlock(message: ChatMessage, block: { name: string; id?: string }) {
  return message.attachments?.find((item) => (block.id ? item.id === block.id : item.name === block.name))
}

/** A user message's parts in the order it was written. */
export function userMessageParts(message: ChatMessage): UserMessagePart[] {
  return message.content.flatMap((block): UserMessagePart[] => {
    if (block.type === 'image' || block.type === 'document') {
      const attachment = attachmentForBlock(message, block)
      return attachment ? [{ attachment }] : []
    }
    if (block.type !== 'text') return []
    if (block.isPaste) return [{ paste: block.text }]
    return parseUserMentions(block.text).map((seg): UserMessagePart => (seg.type === 'mention'
      ? { mention: { kind: seg.kind, value: seg.value, displayName: seg.displayName ?? seg.value } }
      : { text: seg.text }))
  })
}
