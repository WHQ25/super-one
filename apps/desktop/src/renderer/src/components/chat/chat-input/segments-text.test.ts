import { segmentsText } from './segments-text'

describe('segmentsText', () => {
  it('keeps a one-line paste in the sentence it was pasted into', () => {
    expect(segmentsText([
      { text: '看一下', isPaste: false },
      { text: 'useComposerDraftSync', isPaste: true },
      { text: '为什么不生效', isPaste: false },
    ])).toBe('看一下 useComposerDraftSync 为什么不生效')
  })

  it('puts a multi-line paste and text around attachments on their own lines', () => {
    expect(segmentsText([
      { text: 'see', isPaste: false },
      { text: 'a\nb', isPaste: true },
      { text: 'then', isPaste: false },
      { attachmentId: 'img' },
      { text: 'after', isPaste: false },
    ])).toBe('see\na\nb\nthen\nafter')
  })
})
