import { describe, expect, it } from 'vitest'
import { attachmentForBlock, isLongPaste, mentionLabel, pasteSummary } from './user-message-parts'

describe('pasteSummary', () => {
  it('collapses lines and whitespace into one line', () => {
    expect(pasteSummary('  first line\n\n\tsecond   line \n')).toBe('first line second line')
  })

  it('cuts long text at 40 characters with an ellipsis', () => {
    expect(pasteSummary('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`)
  })

  it('never splits a surrogate pair', () => {
    expect(pasteSummary('😀'.repeat(41))).toBe(`${'😀'.repeat(40)}…`)
  })
})

describe('isLongPaste', () => {
  it('chips ten lines or 500 characters', () => {
    expect(isLongPaste('a\n'.repeat(9))).toBe(true)
    expect(isLongPaste('a\n'.repeat(8))).toBe(false)
    expect(isLongPaste('x'.repeat(500))).toBe(true)
  })
})

describe('mentionLabel', () => {
  it('shows a path mention by its last segment and a labelled one by its name', () => {
    expect(mentionLabel('file', 'src/a/b.ts', 'b.ts')).toBe('b.ts')
    expect(mentionLabel('directory', 'src/a/', 'a')).toBe('a')
    expect(mentionLabel('session', 'sid-1', 'Fix the login')).toBe('Fix the login')
    expect(mentionLabel('miniapp', 'app.id')).toBe('app.id')
  })
})

describe('attachmentForBlock', () => {
  const photo = { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/png', base64: 'AA==' }

  it('resolves a block to its attachment by id, or by name for older messages', () => {
    const renamed = { ...photo, name: 'other.jpg' }
    expect(attachmentForBlock({ attachments: [renamed] }, { name: 'IMG_0005.jpg', id: 'a1' })).toBe(renamed)
    expect(attachmentForBlock({ attachments: [photo] }, { name: 'IMG_0005.jpg' })).toBe(photo)
    expect(attachmentForBlock({ attachments: [photo] }, { name: 'missing.jpg', id: 'nope' })).toBeUndefined()
    expect(attachmentForBlock({}, { name: 'IMG_0005.jpg' })).toBeUndefined()
  })
})
