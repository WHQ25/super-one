import type { DraftAttachment } from './draft-rpc'

export function hasPersistableDraftContent(draft: {
  text: string
  docJson?: object | null
  attachments?: readonly unknown[]
}): boolean {
  if (draft.text.trim() || draft.attachments?.length) return true
  const pending: unknown[] = [draft.docJson]
  const seen = new Set<object>()
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)
    const { type, text, attrs, content } = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }
    if (type === 'text' && typeof text === 'string' && text.trim()) return true
    const value = type === 'pasteChip' ? attrs?.text : type === 'mention' ? attrs?.value : null
    if (typeof value === 'string' && value.trim()) return true
    if (Array.isArray(content)) pending.push(...content)
  }
  return false
}

/**
 * A draft as it travels to a device that does not need its attachment bytes:
 * list rows, change notices, and the lease-only open a phone does right before
 * sending a draft it already holds. `data` is emptied rather than dropped so
 * chip identity and `hasPersistableDraftContent` survive; a composer is only
 * ever loaded from a full `open_draft` reply.
 */
export function withoutDraftAttachmentBytes<T extends { attachments: DraftAttachment[] }>(draft: T): T {
  if (!draft.attachments.some((attachment) => attachment.data)) return draft
  return { ...draft, attachments: draft.attachments.map((attachment) => ({ ...attachment, data: '' })) }
}
