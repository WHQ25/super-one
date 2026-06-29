import type { ChatMessage } from '@superone/shared/agent-types'
import { compareMessageSeq } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'
import { applyContentDelta } from '@superone/shared/content-delta'

export const applyDelta = applyContentDelta

export function extractSessionTitle(messages: ChatMessage[]): string | null {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  const text = firstUserMsg?.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ') ?? ''
  return stripMiniAppMarkup(text).slice(0, 100) || null
}

export function mergeMessagesByMaxSeq(snap: ChatMessage[], existing: ChatMessage[]): ChatMessage[] {
  const existingById = new Map(existing.map((m) => [m.id, m]))
  const result: ChatMessage[] = []
  const seen = new Set<string>()
  for (const sm of snap) {
    const em = existingById.get(sm.id)
    if (!em) {
      result.push(sm)
    } else {
      result.push(compareMessageSeq(em, sm) > 0 ? em : sm)
    }
    seen.add(sm.id)
  }
  for (const em of existing) {
    if (!seen.has(em.id)) result.push(em)
  }
  return result
}
