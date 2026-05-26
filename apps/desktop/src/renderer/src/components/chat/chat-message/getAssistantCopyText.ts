import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * Compute the text to copy when the user clicks the "copy assistant
 * reply" button. Codex messages prefer the joined `agent_message` items
 * stream (because their `content` only carries the final text block at
 * completion time); Claude messages stream through `content` blocks
 * directly.
 *
 * Returns `undefined` for user messages — the copy chip is hidden in
 * that case.
 */
export function getAssistantCopyText(message: ChatMessage): string | undefined {
  if (message.role === 'user') return undefined

  const isCodex = message.providerId === 'codex'
  if (isCodex) {
    const codexText = message.metadata?.codex?.items
      ?.filter((item) => item.type === 'agent_message')
      .map((item) => item.text)
      .join('\n\n')
      .trim()
    if (codexText) return codexText
  }

  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
}
