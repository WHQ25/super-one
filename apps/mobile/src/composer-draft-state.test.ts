import { describe, expect, it } from 'vitest'
import { ComposerDraftState } from './composer-draft-state'
import { parseMentionEditorSnapshot } from './mention-editor-state'
import { nativeMentionSpans, nativeMentionText } from './mention-document'
import { parseUserMentions } from '../../desktop/src/renderer/src/components/chat/user-mention-parser'

function fileDraft(path: string, eventCount: number) {
  return parseMentionEditorSnapshot({ text: '\uFFFC ', tokens: [{ offset: 0, kind: 'file', value: path, displayName: path }], eventCount, start: 2, end: 2, composing: false })
}

describe('structured composer draft lifecycle', () => {
  it('preserves identity across native remount and emits a readable session title', () => {
    const state = new ComposerDraftState()
    state.accept(fileDraft('src/中文 file.ts', 5))
    const before = state.capture()
    const document = state.document.current
    state.accept(parseMentionEditorSnapshot({ text: nativeMentionText(document), tokens: nativeMentionSpans(document), eventCount: 1, start: 0, end: 0, composing: false }))
    expect(state.capture().text).toBe(before.text)
    expect(state.capture().title).toBe('@src/中文 file.ts')
    expect(parseUserMentions(state.capture().text)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'file', value: 'src/中文 file.ts' })]))
  })

  it('retains a changed identity while an earlier send is in flight even if placeholder text is unchanged', async () => {
    const state = new ComposerDraftState()
    state.accept(fileDraft('first.ts', 1), 100)
    const sent = state.capture()
    let finish!: () => void
    const sending = new Promise<void>((resolve) => { finish = resolve })
    state.accept(fileDraft('second.ts', 2), 200)
    finish(); await sending
    expect(state.isCurrent(sent.revision)).toBe(false)
    expect(state.capture().text).toContain('second.ts')
    expect(sent.text).toContain('first.ts')
  })

  it('does not treat cursor movement as a new draft or restart the IME settle window', () => {
    const state = new ComposerDraftState()
    const draft = fileDraft('a.ts', 1)
    state.accept(draft, 100)
    const sent = state.capture()
    expect(state.accept({ ...draft, start: 0, end: 0 }, 200)).toBe(false)
    expect(state.isCurrent(sent.revision)).toBe(true)
    expect(state.lastChangeAt.current).toBe(100)
    state.changeText('new draft', 300)
    expect(state.isCurrent(sent.revision)).toBe(false)
  })
})
