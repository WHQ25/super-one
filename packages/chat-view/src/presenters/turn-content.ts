import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { withCodexContent } from '@superone/shared/codex-content'
import { turnDisplayContent } from '@superone/chat-core/turn-process/portable'
import type { GroupContentResult } from './groupContent'

export { turnDisplayContent }

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
