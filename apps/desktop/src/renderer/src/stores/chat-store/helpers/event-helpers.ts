import type { ChatMessage } from '@superone/shared/agent-types'
import { compareMessageSeq } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { SESSION_TITLE_MAX_CHARS } from '@superone/shared/session-title'
import { applyContentDelta } from '@superone/shared/content-delta'

export const applyDelta = applyContentDelta

export function extractSessionTitle(messages: ChatMessage[]): string | null {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  const text = firstUserMsg?.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ') ?? ''
  return stripMiniAppMarkup(text).slice(0, SESSION_TITLE_MAX_CHARS) || null
}

export function mergeMessagesByMaxSeq(snap: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
  const existingById = new Map(existing.map((m) => [m.id, m]))
  const snapIds = new Set(snap.map((m) => m.id))
  // Rows main never saw — the `__compact__` / `__turn_meta__` markers a reducer
  // splices in — carry no place in the snapshot order. Re-insert each ahead of
  // the row it locally preceded; only rows with nothing left to precede are
  // genuinely newer than the snapshot and belong at the end. Appending them all
  // instead drags a compact divider to the bottom of the transcript, where it
  // collapses the live turn and takes `isLastAssistant` off the streaming reply.
  const localOnlyBefore = new Map<string, ChatMessage[]>()
  let pending: ChatMessage[] = []
  for (const em of existing) {
    if (!snapIds.has(em.id)) {
      pending.push(em)
    } else if (pending.length > 0) {
      localOnlyBefore.set(em.id, pending)
      pending = []
    }
  }

  const result: ChatMessage[] = []
  for (const sm of snap) {
    const before = localOnlyBefore.get(sm.id)
    if (before) result.push(...before)
    const em = existingById.get(sm.id)
    result.push(em && compareMessageSeq(em, sm) > 0 ? em : sm)
  }
  result.push(...pending)
  return result
}
