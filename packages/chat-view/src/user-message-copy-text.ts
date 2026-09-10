import type { ChatMessage } from '@superone/shared/agent-types'
import { parseUserMentions, type UserTextSegment } from '@superone/shared/user-mention-parser'

/** Same label the chip shows: display name when it has one, else the path's last segment. */
function mentionLabel(segment: Extract<UserTextSegment, { type: 'mention' }>): string {
  if (segment.displayName) return segment.displayName
  return segment.value.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) || segment.value
}

/**
 * The text a user bubble puts on the clipboard: what the bubble *shows*, not
 * the raw prompt. Agent-only reminder blocks are dropped and structured
 * mention tags collapse to the `@name` the chip displays, so the copy reads
 * as the message the user remembers typing.
 */
export function userMessageCopyText(message: ChatMessage): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type !== 'text') continue
    const rendered = parseUserMentions(block.text)
      .map((segment) => segment.type === 'text' ? segment.text : `@${mentionLabel(segment)}`)
      .join('')
    if (rendered.trim()) parts.push(rendered)
  }
  return parts.join('\n')
}
