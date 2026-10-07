/** @vitest-environment jsdom */

import { liftBlockPasteChips } from './paste-chip-node'

describe('liftBlockPasteChips', () => {
  it('wraps a saved top-level paste chip in a paragraph for the inline schema', () => {
    const chip = { type: 'pasteChip', attrs: { text: 'saved log' } }
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see' }] }, chip] }

    expect(liftBlockPasteChips(doc).content).toEqual([doc.content[0], { type: 'paragraph', content: [chip] }])
  })

  it('returns a doc with inline chips unchanged', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'pasteChip', attrs: { text: 'log' } }] }] }

    expect(liftBlockPasteChips(doc)).toBe(doc)
  })
})
