import { describe, expect, it } from 'vitest'
import { parseUserMentions } from '../../desktop/src/renderer/src/components/chat/user-mention-parser'
import {
  MENTION_OBJECT, nativeMentionSpans, nativeMentionText, plainMentionText, documentFromNativeMentions,
  replaceMentionRange, serializeMentionDocument, type MentionDocument, type MentionToken,
} from './mention-document'

const file: MentionToken = { kind: 'file', value: 'src/中文 file.ts', displayName: '中文 file.ts' }
const agent: MentionToken = { kind: 'agent-profile', value: 'acp-base:grok-build', displayName: 'Grok' }

describe('native mention document', () => {
  it('recovers native span order and rejects duplicated or misplaced identities', () => {
    expect(documentFromNativeMentions(`x${MENTION_OBJECT}y${MENTION_OBJECT}`, [
      { ...agent, offset: 3 }, { ...file, offset: 1 },
    ])).toEqual([{ text: 'x' }, { mention: file }, { text: 'y' }, { mention: agent }])
    expect(() => documentFromNativeMentions('plain', [{ ...file, offset: 0 }])).toThrow(RangeError)
    expect(() => documentFromNativeMentions(MENTION_OBJECT, [{ ...file, offset: 0 }, { ...agent, offset: 0 }])).toThrow(RangeError)
  })
  it('represents each chip as one native position while preserving UTF-16 offsets', () => {
    const document: MentionDocument = [{ text: '🙂看 ' }, { mention: file }, { text: ' 和 ' }, { mention: agent }]
    expect(nativeMentionText(document)).toBe(`🙂看 ${MENTION_OBJECT} 和 ${MENTION_OBJECT}`)
    expect(nativeMentionSpans(document)).toEqual([{ ...file, offset: 4 }, { ...agent, offset: 8 }])
    expect(plainMentionText(document)).toBe('🙂看 @src/中文 file.ts 和 @Grok')
  })

  it('inserts a chip at the active query without losing the trailing draft', () => {
    const result = replaceMentionRange([{ text: '检查 @sr 然后测试' }], { start: 3, end: 6 }, [{ mention: file }, { text: ' ' }])
    expect(nativeMentionText(result.document)).toBe(`检查 ${MENTION_OBJECT}  然后测试`)
    expect(result.selection).toEqual({ start: 5, end: 5 })
  })

  it('deletes a whole chip with one backspace and merges the surrounding text', () => {
    const document: MentionDocument = [{ text: 'a' }, { mention: file }, { text: 'b' }]
    const result = replaceMentionRange(document, { start: 1, end: 2 }, [])
    expect(result).toEqual({ document: [{ text: 'ab' }], selection: { start: 1, end: 1 } })
    expect(document).toHaveLength(3)
  })

  it('replaces a mixed selection spanning multiple chips', () => {
    const document: MentionDocument = [{ text: 'a' }, { mention: file }, { text: ' and ' }, { mention: agent }, { text: 'z' }]
    const result = replaceMentionRange(document, { start: 1, end: 8 }, [{ text: 'done' }])
    expect(result.document).toEqual([{ text: 'adonez' }])
    expect(nativeMentionSpans(result.document)).toEqual([])
  })

  it('preserves chip identities when IME replaces adjacent composing text', () => {
    const document: MentionDocument = [{ mention: file }, { text: 'nihao' }, { mention: agent }]
    const result = replaceMentionRange(document, { start: 1, end: 6 }, [{ text: '你好' }])
    expect(nativeMentionSpans(result.document)).toEqual([{ ...file, offset: 0 }, { ...agent, offset: 3 }])
  })

  it('does not turn clipboard @text or orphan object characters into tokens', () => {
    const result = replaceMentionRange([], { start: 0, end: 0 }, [{ text: `@codex ${MENTION_OBJECT}` }])
    expect(nativeMentionSpans(result.document)).toEqual([])
    expect(serializeMentionDocument(result.document)).toBe('@codex \uFFFD')
    expect(() => replaceMentionRange([], { start: -1, end: 0 }, [])).toThrow(RangeError)
  })

  it('sends identities that the actual desktop bubble parser recovers', () => {
    const mentions: MentionToken[] = [file, agent,
      { kind: 'directory', value: 'src', displayName: 'src' },
      { kind: 'agent', value: 'reviewer', displayName: 'Reviewer' },
      { kind: 'widget', value: 'widget', displayName: 'Widget' },
      { kind: 'miniapp', value: 'app-1', displayName: 'App' },
      { kind: 'desktop-app', value: 'com.example.app', displayName: 'Editor' },
      { kind: 'session', value: 'session-1', displayName: 'Review' },
    ]
    const serialized = serializeMentionDocument([{ text: 'Typed @codex stays plain. ' }, ...mentions.map((mention) => ({ mention }))])
    const recovered = parseUserMentions(serialized)
    expect(recovered.filter((part) => part.type === 'mention')).toEqual(mentions.map((mention) => ({
      type: 'mention', ...mention, value: mention.kind === 'directory' ? 'src/' : mention.value,
    })))
    expect(recovered[0]).toMatchObject({ type: 'text', text: 'Typed @codex stays plain.  ' })
  })
})
