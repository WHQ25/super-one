import { describe, expect, it } from 'vitest'
import { parseUserMentions } from '../../desktop/src/renderer/src/components/chat/user-mention-parser'
import { parseMentionEditorSnapshot } from './mention-editor-state'
import { nativeMentionSpans, nativeMentionText, replaceMentionRange, documentFromNativeMentions, serializeMentionDocument } from './mention-document'
import { mentionTokenFromItem, selectNativeMention } from './mention-selection'

const snapshot = (text: string, cursor = text.length) => parseMentionEditorSnapshot({ text, tokens: [], start: cursor, end: cursor, eventCount: 4, composing: false })

describe('native suggestion selection to desktop message', () => {
  it('replaces only the query and sends the chosen file identity after native acknowledgement', () => {
    const draft = snapshot('🙂检查 @src 然后测试', 9)
    const command = selectNativeMention(draft, { kind: 'file', path: 'src/中文 file.ts' }, 8)!
    expect(command).toMatchObject({ id: 8, eventCount: 4, start: 5, end: 9, text: '\uFFFC ' })
    expect(draft.text).toBe('🙂检查 @src 然后测试')
    const edited = replaceMentionRange(draft.document, command, documentFromNativeMentions(command.text, command.tokens))
    const acknowledged = parseMentionEditorSnapshot({ text: nativeMentionText(edited.document), tokens: nativeMentionSpans(edited.document), ...edited.selection, eventCount: 5, composing: false })
    const serialized = serializeMentionDocument(acknowledged.document)
    expect(serialized).toContain('src/中文 file.ts')
    expect(serialized).toContain('然后测试')
    expect(parseUserMentions(serialized)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'file', value: 'src/中文 file.ts' })]))
  })

  it('keeps project-agent names distinct from discovered provider references', () => {
    expect(mentionTokenFromItem({ kind: 'agent', path: 'codex' })).toEqual({ kind: 'agent', value: 'codex', displayName: 'codex' })
    expect(mentionTokenFromItem({ kind: 'agent-profile', path: 'acp-base:grok-build', label: '@Grok' })).toEqual({ kind: 'agent-profile', value: 'acp-base:grok-build', displayName: 'Grok' })
    expect(mentionTokenFromItem({ kind: 'builtin', path: 'debug', label: '@debug' })?.kind).toBe('debug')
  })

  it('keeps folder traversal editable and rejects unknown identities or composing selections', () => {
    const draft = snapshot('@sr')
    expect(selectNativeMention(draft, { kind: 'dir-entry', path: 'src/', isDirectory: true }, 1)).toMatchObject({ text: '@src/', tokens: [] })
    expect(selectNativeMention(draft, { kind: 'future', path: 'thing' }, 1)).toBeUndefined()
    expect(selectNativeMention({ ...draft, composing: true }, { kind: 'file', path: 'src/a.ts' }, 1)).toBeUndefined()
    expect(selectNativeMention({ ...draft, start: 0 }, { kind: 'file', path: 'src/a.ts' }, 1)).toBeUndefined()
    expect(selectNativeMention(snapshot('plain @word '), { kind: 'file', path: 'a.ts' }, 1)).toBeUndefined()
  })
})
