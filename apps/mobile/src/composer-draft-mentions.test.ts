import { describe, expect, it } from 'vitest'
import { ComposerDraftState } from './composer-draft-state'
import { documentFromText } from './mention-document'
import { mentionInsertText } from './mentions'
import { mentionTokenFromItem } from './mention-selection'

/**
 * What the *plain* editor sends.
 *
 * The native editor keeps identities in its spans; the fallback is an ordinary
 * `TextInput` and used to flatten every mention to the literal `@text` the user
 * saw. For a file that reads fine, but a session went out as a bare UUID with
 * no title and a capability as a word the host never expanded.
 */
const insert = (draft: ComposerDraftState, item: Parameters<typeof mentionTokenFromItem>[0], text: string) => {
  const token = mentionTokenFromItem(item)
  if (token) draft.recordMention(mentionInsertText(item), token)
  draft.changeText(text)
}

describe('plain-text draft serialisation', () => {
  it('sends a session as the tag the desktop parses, not as its id', () => {
    const draft = new ComposerDraftState()
    const item = { kind: 'session', path: 'sess-7f3c', label: 'Align the mention popup' }
    insert(draft, item, `see @${item.path} for context`)
    expect(draft.capture().text).toContain(
      '<superone-session><title>Align the mention popup</title><sessionId>sess-7f3c</sessionId></superone-session>',
    )
  })

  it('expands a capability the host would otherwise never see', () => {
    const draft = new ComposerDraftState()
    insert(draft, { kind: 'builtin', path: 'widget', label: 'Widget' }, '@widget draw me a chart')
    expect(draft.capture().text).toMatch(/<superone-capability|widget/)
    expect(draft.capture().text).not.toBe('@widget draw me a chart')
  })

  it('stops treating an insertion as a mention once the user edits it away', () => {
    const draft = new ComposerDraftState()
    insert(draft, { kind: 'session', path: 'sess-7f3c', label: 'Align' }, '@sess-7f3c hello')
    draft.changeText('hello on its own')
    expect(draft.capture().text).toBe('hello on its own')
  })

  it('keeps the title readable while the payload carries the tag', () => {
    const draft = new ComposerDraftState()
    insert(draft, { kind: 'session', path: 'sess-7f3c', label: 'Align the mention popup' }, '@sess-7f3c ship it')
    // The title is what the user sees in the list, so it reads as the session's
    // name rather than as its id.
    expect(draft.capture().title).toBe('@Align the mention popup ship it')
  })

  it('leaves a draft with no recorded mention exactly as typed', () => {
    const draft = new ComposerDraftState()
    draft.changeText('plain words only')
    expect(draft.capture().text).toBe('plain words only')
  })
})

describe('documentFromText', () => {
  const token = { kind: 'file', value: 'src/a.ts', displayName: 'a.ts' } as const

  it('splits the text around the inserted mention', () => {
    expect(documentFromText('see @src/a.ts now', [{ text: '@src/a.ts', mention: token }])).toEqual([
      { text: 'see ' }, { mention: token }, { text: ' now' },
    ])
  })

  it('prefers the longer insertion when two start at the same place', () => {
    // A recorded `@src` must not shadow the file the user actually picked.
    const short = { text: '@src', mention: { kind: 'directory', value: 'src', displayName: 'src' } as const }
    const long = { text: '@src/a.ts', mention: token }
    expect(documentFromText('@src/a.ts', [short, long])).toEqual([{ mention: token }])
  })

  it('marks every occurrence, because the user may have pasted it twice', () => {
    const document = documentFromText('@src/a.ts and @src/a.ts', [{ text: '@src/a.ts', mention: token }])
    expect(document.filter((segment) => 'mention' in segment)).toHaveLength(2)
  })
})
