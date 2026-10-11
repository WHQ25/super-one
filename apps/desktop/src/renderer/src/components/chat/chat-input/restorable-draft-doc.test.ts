import { describe, expect, it } from 'vitest'
import { restorableDraftDoc } from './restorable-draft-doc'

describe('restorableDraftDoc', () => {
  it('drops link marks a draft saved with the old Link extension carries', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'https://a.dev', marks: [{ type: 'link', attrs: { href: 'https://a.dev' } }] },
    ] }] }
    expect(restorableDraftDoc(doc)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'https://a.dev' },
    ] }] })
  })

  it('drops underline marks too, and lifts block paste chips', () => {
    const chip = { type: 'pasteChip', attrs: { text: 'x' } }
    const doc = { type: 'doc', content: [chip, { type: 'paragraph', content: [{ type: 'text', text: 'u', marks: [{ type: 'underline' }] }] }] }
    expect(restorableDraftDoc(doc).content).toEqual([
      { type: 'paragraph', content: [chip] },
      { type: 'paragraph', content: [{ type: 'text', text: 'u' }] },
    ])
  })
})
