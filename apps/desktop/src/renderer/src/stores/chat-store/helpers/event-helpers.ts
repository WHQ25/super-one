import type { ChatMessage } from '@superone/shared/agent-types'
import { compareMessageSeq } from '@superone/shared/event-seq-utils'
import { getSessionTitle } from '@/lib/session-title'
import { applyContentDelta } from '@superone/shared/content-delta'

export const applyDelta = applyContentDelta

export const extractSessionTitle = getSessionTitle

export function mergeMessagesByMaxSeq(snap: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
  const existingById = new Map(existing.map((m) => [m.id, m]))
  const snapIds = new Set(snap.map((m) => m.id))
  // Rows main never saw — the `__turn_meta__` markers a reducer splices in, or a
  // `__compact__` divider minted before main stamped ids on the boundary event —
  // carry no place in the snapshot order. Re-insert each ahead of
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
