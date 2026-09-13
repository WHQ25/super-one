import { describe, expect, it } from 'vitest'
import { imageNote, recordingNote } from './show-your-work-notes'

describe('show-your-work notes', () => {
  it.each([
    ['image.path', imageNote, 'what to look at'],
    ['screenshot.path', imageNote, 'what to look at'],
    ['recording.savedPath', recordingNote, 'what happens in it'],
  ] as const)('selects %s by its value to the reply, including reused inspection captures', (field, makeNote, caption) => {
    const note = makeNote(field)
    expect(note).toContain(`embed ${field} with ![${caption}](<path>)`)
    expect(note).toMatch(/user requested.*capture/)
    expect(note).toMatch(/directly supports a visual claim/)
    expect(note).toMatch(/Reuse.*inspection capture/)
    expect(note).toMatch(/Omit captures that only document/)
    expect(note).toContain('read_manual product/show-your-work')
    expect(note).not.toMatch(/^Show this to the user/)
  })
})
