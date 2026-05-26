import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { compareMessageSeq } from '@superone/shared/event-seq-utils'
import { stripMiniAppMarkup } from '@superone/shared/miniapp-prompt-tags'

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

function sameParent(a: ContentBlock, b: ContentBlock): boolean {
  const ap = 'parentToolUseId' in a ? a.parentToolUseId ?? null : null
  const bp = 'parentToolUseId' in b ? b.parentToolUseId ?? null : null
  return ap === bp
}

export function applyDelta(content: ContentBlock[], delta: ContentBlock): ContentBlock[] {
  if (delta.type === 'text') {
    const last = content[content.length - 1]
    if (last?.type === 'text' && sameParent(last, delta)) {
      return [...content.slice(0, -1), { ...last, text: last.text + delta.text }]
    }
  }
  if (delta.type === 'thinking') {
    const last = content[content.length - 1]
    if (last?.type === 'thinking' && sameParent(last, delta)) {
      return [...content.slice(0, -1), { ...last, thinking: last.thinking + delta.thinking }]
    }
  }
  if (delta.type === 'tool_use') {
    const idx = content.findIndex((b) => b.type === 'tool_use' && b.toolUseId === delta.toolUseId)
    if (idx !== -1) {
      const existing = content[idx]
      const preserved = existing.type === 'tool_use'
        ? { startedAt: existing.startedAt, elapsedSeconds: existing.elapsedSeconds, ...(!delta.status && existing.status ? { status: existing.status } : {}) }
        : {}
      return content.map((b, i) => (i === idx ? { ...preserved, ...delta } : b))
    }
    return [...content, { ...delta, startedAt: Date.now() }]
  }
  if (delta.type === 'tool_result') {
    const updated = content.map((b) =>
      b.type === 'tool_use' && b.toolUseId === delta.toolUseId ? { ...b, status: 'complete' as const } : b,
    )
    return [...updated, delta]
  }
  return [...content, delta]
}
