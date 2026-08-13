import { describe, expect, it } from 'vitest'
import { plainTextToTiptapDoc, plainTextToTiptapParagraphContent } from './plainTextToTiptapDoc'

describe('plainTextToTiptapParagraphContent', () => {
  it('keeps a single line as one text node', () => {
    expect(plainTextToTiptapParagraphContent('Ship it.')).toEqual([
      { type: 'text', text: 'Ship it.' },
    ])
  })

  it('turns newlines into hardBreak nodes', () => {
    expect(plainTextToTiptapParagraphContent('Line 1\nLine 2\n\nLine 4')).toEqual([
      { type: 'text', text: 'Line 1' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Line 2' },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Line 4' },
    ])
  })

  it('accepts CRLF', () => {
    expect(plainTextToTiptapParagraphContent('a\r\nb')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'hardBreak' },
      { type: 'text', text: 'b' },
    ])
  })
})

describe('plainTextToTiptapDoc', () => {
  it('wraps inline nodes in a paragraph', () => {
    expect(plainTextToTiptapDoc('a\nb')).toEqual({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'hardBreak' },
          { type: 'text', text: 'b' },
        ],
      }],
    })
  })
})
