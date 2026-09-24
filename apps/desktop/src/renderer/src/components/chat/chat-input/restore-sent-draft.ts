import type { ImageAttachment } from '@superone/shared/agent-types'
import type { PerSessionState } from '@/stores/chat-store/types'
import { plainTextToTiptapDoc } from './plainTextToTiptapDoc'

/** Merge a refused send back into its original session, preserving later typing. */
export function restoreAttachmentDraft(current: Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments'>,
  saved: { text: string; doc: object | null; attachments: ImageAttachment[] },
): Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments'> {
  const priorDoc = saved.doc ?? plainTextToTiptapDoc(saved.text)
  const nextDoc = current.draftJson ?? plainTextToTiptapDoc(current.draftText)
  const hasNewText = Boolean(current.draftText.trim())
  const contentOf = (doc: object) => (doc as { content?: unknown[] }).content ?? []
  const existingIds = new Set(current.attachments.map(a => a.id))
  return {
    draftText: hasNewText ? `${saved.text}\n${current.draftText}` : saved.text,
    draftJson: hasNewText ? { type: 'doc', content: [...contentOf(priorDoc), ...contentOf(nextDoc)] } : priorDoc,
    attachments: [...saved.attachments.filter(a => !existingIds.has(a.id)), ...current.attachments],
  }
}
