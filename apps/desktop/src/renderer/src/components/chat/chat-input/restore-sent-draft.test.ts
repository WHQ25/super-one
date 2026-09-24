import { expect, it } from 'vitest'
import { restoreAttachmentDraft } from './restore-sent-draft'
import { PNG_ATTACHMENT } from '@superone/shared/test-fixtures/attachments'

it('restores the original document while preserving text typed after a refused send', () => {
  const saved = { text: 'original', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'file' } }] }] }, attachments: [{ ...PNG_ATTACHMENT, id: 'a' }] }
  const restored = restoreAttachmentDraft({ draftText: 'new words', draftJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new words' }] }] }, attachments: [] }, saved)
  expect(restored.draftText).toBe('original\nnew words')
  expect((restored.draftJson as { content: unknown[] }).content).toHaveLength(2)
  expect(restored.attachments).toEqual(saved.attachments)
  expect(restoreAttachmentDraft({ draftText: '', draftJson: null, attachments: saved.attachments }, saved).attachments).toHaveLength(1)
})
