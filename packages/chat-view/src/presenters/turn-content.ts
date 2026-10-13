import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { withCodexContent } from '@superone/shared/codex-content'
import type { GroupContentResult } from './groupContent'

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

/** Sliced rows share the whole turn's collapse threshold, statistics and toggle. */
export function buildCompactTurn(
  row: { source: ChatMessage; following?: ChatMessage; id: string; first?: boolean },
  group: (content: ContentBlock[]) => GroupContentResult,
) {
  if (!row.following && row.id === row.source.id) return undefined
  const grouped = (message: ChatMessage) => group(turnDisplayContent(withCodexContent(message)))
  return { id: row.source.id, grouped: grouped(row.source),
    following: row.following ? grouped(row.following) : undefined, showIndicator: row.first ?? row.id === row.source.id }
}
