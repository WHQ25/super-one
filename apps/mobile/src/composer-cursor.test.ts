import { describe, expect, it } from 'vitest'
import { cursorAfterEdit } from './composer-cursor'
import { extractMentionQuery, insertMention, parseMentionItems } from './mentions'

describe('composer cursor', () => {
  it('keeps a middle-of-draft mention and suffix intact', () => {
    const before = '检查 @sr 然后运行测试'
    const after = '检查 @src 然后运行测试'
    const cursor = cursorAfterEdit(before, after, { start: 6, end: 6 })
    expect(cursor).toEqual({ start: 7, end: 7 })
    const query = extractMentionQuery(after, cursor.end)!
    expect(query).toEqual({ atPosition: 3, query: 'src' })
    expect(insertMention(after, query, { kind: 'file', path: 'src/app.ts' })).toBe('检查 @src/app.ts  然后运行测试')
  })

  it('uses selection to disambiguate insertion among repeated characters', () => {
    expect(cursorAfterEdit('aaa', 'aaaa', { start: 2, end: 2 })).toEqual({ start: 3, end: 3 })
    expect(cursorAfterEdit('aaa', 'aa', { start: 1, end: 2 })).toEqual({ start: 1, end: 1 })
  })

  it('handles backspace, replaced ranges, and IME replacement before the suffix', () => {
    expect(cursorAfterEdit('@src rest', '@sr rest', { start: 4, end: 4 })).toEqual({ start: 3, end: 3 })
    expect(cursorAfterEdit('你好 rest', '🙂 rest', { start: 0, end: 2 })).toEqual({ start: 2, end: 2 })
    expect(cursorAfterEdit('nihao rest', '你好 rest', { start: 5, end: 5 })).toEqual({ start: 2, end: 2 })
  })
})

describe('mention search payloads', () => {
  it('retains labels and descriptions and ignores malformed entries', () => {
    expect(parseMentionItems([null, 'invalid', {}, { path: 123 }, {
      path: 'src/app.ts', label: 'Application', description: 'Main entry', kind: 'file', isDirectory: 'false',
    }])).toEqual([{ path: 'src/app.ts', kind: 'file', label: 'Application', description: 'Main entry', isDirectory: false }])
    expect(parseMentionItems(null)).toEqual([])
  })

  it('recognizes whitespace boundaries without continuing a closed token', () => {
    expect(extractMentionQuery('see\t@src', 8)).toEqual({ atPosition: 4, query: 'src' })
    expect(extractMentionQuery('@src\tmore', 9)).toBeNull()
  })
})
