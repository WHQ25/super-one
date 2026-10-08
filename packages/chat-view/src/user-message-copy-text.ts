import type { ChatMessage } from '@superone/shared/agent-types'
import { parseUserMentions } from '@superone/shared/user-mention-parser'
import { mentionLabel } from '@superone/shared/user-message-parts'

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
      .map((segment) => segment.type === 'text' ? segment.text : `@${mentionLabel(segment.kind, segment.value, segment.displayName)}`)
      .join('')
    if (rendered.trim()) parts.push(rendered)
  }
  return parts.join('\n')
}
