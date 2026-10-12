import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

function isOffTranscript(block: ContentBlock, failed: boolean): boolean {
  // The decision queue asks an async question; the answer bubble keeps it.
  if (block.type === 'text') return Boolean(block.codexAsyncQuestions?.length)
  // A failed turn's footer reports its error once.
  return failed && block.type === 'notice' && block.level === 'error'
}

/**
 * The blocks an assistant turn draws. The same array when nothing is left out,
 * so memoized grouping keeps its identity.
 */
export function turnDisplayContent(message: Pick<ChatMessage, 'content' | 'status'>): ContentBlock[] {
  const failed = message.status === 'error'
  return message.content.some(block => isOffTranscript(block, failed))
    ? message.content.filter(block => !isOffTranscript(block, failed))
    : message.content
}
