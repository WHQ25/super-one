import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { withCodexContent } from '@superone/shared/codex-content'
import { turnDisplayContent } from '@superone/chat-core/turn-process/portable'
import type { GroupContentResult } from './groupContent'

export { turnDisplayContent }

/**
 * What a row cut out of a turn reads from the rest of it: the whole turn decides
 * whether process collapses and what the cut pins. The row keeps its own toggle
 * and statistics, so a long turn opens one stretch between compactions at a time.
 */
export function buildCompactTurn(
  row: { source: ChatMessage; following?: ChatMessage; id: string },
  group: (content: ContentBlock[]) => GroupContentResult,
) {
  if (!row.following && row.id === row.source.id) return undefined
  const grouped = (message: ChatMessage) => group(turnDisplayContent(withCodexContent(message)))
  return { id: row.id, grouped: grouped(row.source), following: row.following ? grouped(row.following) : undefined }
}
