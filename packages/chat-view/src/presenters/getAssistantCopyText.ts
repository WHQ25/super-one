import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * The text the "copy assistant reply" button copies: the turn's own text
 * blocks as paragraphs. A subagent's text stays inside its card and is not
 * copied. Returns `undefined` for user messages — the copy chip is hidden
 * in that case.
 */
export function getAssistantCopyText(message: ChatMessage): string | undefined {
  if (message.role === 'user') return undefined
  return message.content
    .flatMap((block) => block.type === 'text' && !block.parentToolUseId && block.text ? [block.text] : [])
    .join('\n\n')
    .trim()
}
