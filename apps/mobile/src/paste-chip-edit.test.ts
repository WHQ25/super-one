import { describe, expect, it } from 'vitest'
import { parseMentionEditorSnapshot } from './mention-editor-state'
import { pasteChipEditCommand } from './paste-chip-edit'
import { replaceMentionRange, type MentionDocument } from './mention-document'
import { composerMessageContent } from './composer-message-content'

const chip = { offset: 2, value: 'original' }
const snapshot = parseMentionEditorSnapshot({ text: 'a \uFFFC z', start: 3, end: 3, eventCount: 7, composing: false,
  tokens: [{ offset: 2, kind: 'paste', value: 'original', displayName: 'original' }] })

describe('paste chip editing', () => {
  it('replaces just the chip with its edited text, preserving identity and native version', () => {
    expect(pasteChipEditCommand(snapshot, chip, 'new\ntext', 9)).toEqual({ id: 9, eventCount: 7, start: 2, end: 3,
      text: '\uFFFC', tokens: [{ offset: 0, kind: 'paste', value: 'new\ntext', displayName: 'new text' }] })
  })
  it('expands to literal text so long content stays plain in the sent bubble', () => {
    const text = 'x'.repeat(500)
    const command = pasteChipEditCommand(snapshot, chip, text, 9, true)!
    expect(command.tokens).toEqual([])
    const next = replaceMentionRange(snapshot.document, { start: command.start, end: command.end }, [{ text: command.text }])
    expect(composerMessageContent(next.document)).toEqual([{ type: 'text', text: `a ${text} z`, isPaste: false }])
  })
  it('rejects a moved/replaced chip or an active IME composition', () => {
    for (const current of [{ ...chip, offset: 1 }, { ...chip, value: 'different' }]) {
      expect(pasteChipEditCommand(snapshot, current, 'edit', 9)).toBeUndefined()
    }
    expect(pasteChipEditCommand({ ...snapshot, composing: true }, chip, 'edit', 9)).toBeUndefined()
  })
  it('keeps a paste atomic when a selection deletes it alongside a mention', () => {
    const document: MentionDocument = [{ text: 'a' }, { paste: 'full\npaste' }, { mention: { kind: 'file', value: 'a.ts', displayName: 'a.ts' } }, { text: 'z' }]
    expect(replaceMentionRange(document, { start: 1, end: 3 }, []).document).toEqual([{ text: 'az' }])
  })
})
