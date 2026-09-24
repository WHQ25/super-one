import type { ImageAttachment } from '@superone/shared/agent-types'
import type { PerSessionState } from '@/stores/chat-store/types'
import { mergeRestoredDraftText } from '@superone/chat-core'
import { plainTextToTiptapDoc } from './plainTextToTiptapDoc'

/** Merge a send the host never ran back into its session's composer, preserving later typing. */
export function restoreSentDraft(current: Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments'>,
  saved: { text: string; doc: object | null; attachments: ImageAttachment[] },
): Pick<PerSessionState, 'draftText' | 'draftJson' | 'attachments'> {
  const priorDoc = saved.doc ?? plainTextToTiptapDoc(saved.text)
  const nextDoc = current.draftJson ?? plainTextToTiptapDoc(current.draftText)
  const hasNewText = Boolean(current.draftText.trim())
  const contentOf = (doc: object) => (doc as { content?: unknown[] }).content ?? []
  const existingIds = new Set(current.attachments.map(a => a.id))
  return {
    draftText: mergeRestoredDraftText(saved.text, current.draftText),
    draftJson: hasNewText ? { type: 'doc', content: [...contentOf(priorDoc), ...contentOf(nextDoc)] } : priorDoc,
    attachments: [...saved.attachments.filter(a => !existingIds.has(a.id)), ...current.attachments],
  }
}
