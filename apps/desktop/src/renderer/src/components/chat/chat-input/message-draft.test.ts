import type { ChatMessage, ImageAttachment } from '@superone/shared/agent-types'
import { wrapPathRefMention } from '@superone/shared/miniapp-prompt-tags'
import { messageDraft } from './message-draft'

const shot = { id: 'att-1', name: 'shot.png', mimeType: 'image/png', base64: 'QUJD' }
const loose = { name: 'old.png', mimeType: 'image/png', base64: 'QUJD' }

const message = (content: ChatMessage['content'], attachments: ImageAttachment[] = [shot]): ChatMessage => ({
  id: 'user-1', role: 'user', status: 'complete', providerId: 'user', createdAt: '2026-10-05T00:00:00.000Z', content, attachments,
})

describe('messageDraft', () => {
  it('puts every chip back where it was, without the space sending padded mentions with', () => {
    const draft = messageDraft(message([
      { type: 'text', text: `see  ${wrapPathRefMention('file', 'src/a.ts', 'a.ts')}  and` },
      { type: 'image', name: 'shot.png', id: 'att-1' },
      { type: 'text', text: 'then:' },
      { type: 'text', text: 'l1\nl2', isPaste: true },
    ]))

    expect(draft.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'see ' },
      { type: 'mention', attrs: { kind: 'file', value: 'src/a.ts', displayName: 'a.ts' } },
      { type: 'text', text: ' and' },
      { type: 'attachment', attrs: { id: 'att-1' } },
      { type: 'text', text: 'then:' },
      { type: 'pasteChip', attrs: { text: 'l1\nl2' } },
    ] }] })
    expect(draft.attachments).toEqual([shot])
    expect(draft.text).toBe('see  @src/a.ts  andthen:l1\nl2')
  })

  it('brings back an attachment no block points at, after the text, with an id for its chip', () => {
    const draft = messageDraft(message([{ type: 'text', text: 'hi' }], [loose]))

    const id = draft.attachments[0]?.id
    expect(draft.attachments).toEqual([{ ...loose, id: expect.any(String) }])
    expect(draft.doc.content?.[0]?.content).toEqual([{ type: 'text', text: 'hi' }, { type: 'attachment', attrs: { id } }])
  })
})
