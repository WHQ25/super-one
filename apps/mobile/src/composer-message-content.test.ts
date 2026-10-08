import { describe, expect, it } from 'vitest'
import { composerDraftFromMessage, composerMessageContent } from './composer-message-content'
import { localUserMessage } from './runtime-user-message'
import { nativeMentionSpans, nativeMentionText } from './mention-document'
import { ComposerDraftState } from './composer-draft-state'
import { parseMentionEditorSnapshot } from './mention-editor-state'

describe('composed and restored messages', () => {
  it('keeps adjacent mentions and pasted text in their original order', () => {
    const document = [{ text: 'Read ' }, { mention: { kind: 'file' as const, value: 'a.ts', displayName: 'a.ts' } }, { text: ' then ' }, { paste: 'short' }, { text: ' done' }]
    const content = composerMessageContent(document)
    expect(content).toEqual([
      { type: 'text', isPaste: false, text: expect.stringContaining(' then') },
      { type: 'text', isPaste: true, text: 'short' },
      { type: 'text', isPaste: false, text: 'done' },
    ])
    const restored = composerDraftFromMessage(localUserMessage('m', '', undefined, content))
    expect(restored.document).toContainEqual(document[1])
    expect(restored.document).toContainEqual({ paste: 'short' })
    const current = { text: ' next', document: [{ text: ' next' }], insertions: [] }
    expect(composerDraftFromMessage(localUserMessage('m', '', undefined, content), current).document.slice(-2)).toEqual([{ text: '\n\n' }, { text: ' next' }])
  })

  it('does not mark restored chips as paste when a fallback editor only shows their text', () => {
    const state = new ComposerDraftState()
    const document = [{ text: 'before ' }, { paste: 'x'.repeat(500) }, { text: ' after' }]
    state.accept(parseMentionEditorSnapshot({ text: nativeMentionText(document), tokens: nativeMentionSpans(document), start: 0, end: 0, eventCount: 1, composing: false }))
    expect(state.capture(false).userMessageContent).toEqual([{ type: 'text', text: `before ${'x'.repeat(500)} after`, isPaste: false }])
    expect(state.capture(true).userMessageContent[1]).toEqual({ type: 'text', text: 'x'.repeat(500), isPaste: true })
  })
})
