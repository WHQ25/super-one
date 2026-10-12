import type { AgentEvent, CodexThreadItem } from '../agent-types'
import { createCodexContentStream } from '../codex-content'

/** The `content_delta` events a Codex producer sends for these item snapshots of one message. */
export function codexContentEvents(messageId: string, ...items: CodexThreadItem[]): Extract<AgentEvent, { type: 'content_delta' }>[] {
  const stream = createCodexContentStream()
  return items.flatMap(item => stream.update(item).map(({ delta, replace }) =>
    ({ type: 'content_delta' as const, messageId, delta, ...(replace ? { replace } : {}) })))
}
