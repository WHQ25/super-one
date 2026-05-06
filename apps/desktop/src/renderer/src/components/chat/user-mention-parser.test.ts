import { describe, it, expect } from 'vitest'
import { parseUserMentions } from './user-mention-parser'

describe('parseUserMentions', () => {
  it('returns empty array for empty input', () => {
    expect(parseUserMentions('')).toEqual([])
  })

  it('returns single text segment when no mention present', () => {
    expect(parseUserMentions('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ])
  })

  it('parses a leading mention', () => {
    expect(parseUserMentions('@hello.py')).toEqual([
      { type: 'mention', kind: 'file', value: 'hello.py' },
    ])
  })

  it('parses leading mention followed by trailing text', () => {
    expect(parseUserMentions('@hello.py 升级一下版本')).toEqual([
      { type: 'mention', kind: 'file', value: 'hello.py' },
      { type: 'text', text: ' 升级一下版本' },
    ])
  })

  it('regression: parses a mid-text mention (preceded by text + space)', () => {
    expect(parseUserMentions('看看 @hello_world.py 升级一下版本')).toEqual([
      { type: 'text', text: '看看 ' },
      { type: 'mention', kind: 'file', value: 'hello_world.py' },
      { type: 'text', text: ' 升级一下版本' },
    ])
  })

  it('parses a trailing mention', () => {
    expect(parseUserMentions('看看 @hello.py')).toEqual([
      { type: 'text', text: '看看 ' },
      { type: 'mention', kind: 'file', value: 'hello.py' },
    ])
  })

  it('parses consecutive mentions separated by a space', () => {
    expect(parseUserMentions('@a.py @b.py x')).toEqual([
      { type: 'mention', kind: 'file', value: 'a.py' },
      { type: 'text', text: ' ' },
      { type: 'mention', kind: 'file', value: 'b.py' },
      { type: 'text', text: ' x' },
    ])
  })

  it('parses a mention that follows a newline', () => {
    expect(parseUserMentions('看看\n@hello.py 改一下')).toEqual([
      { type: 'text', text: '看看\n' },
      { type: 'mention', kind: 'file', value: 'hello.py' },
      { type: 'text', text: ' 改一下' },
    ])
  })

  it('does not match @ embedded in a word (e.g. email)', () => {
    expect(parseUserMentions('contact user@host.com please')).toEqual([
      { type: 'text', text: 'contact user@host.com please' },
    ])
  })

  it('classifies a directory mention (ends with /)', () => {
    expect(parseUserMentions('@src/')).toEqual([
      { type: 'mention', kind: 'directory', value: 'src/' },
    ])
  })

  it('classifies a file mention containing a slash', () => {
    expect(parseUserMentions('@src/main.ts')).toEqual([
      { type: 'mention', kind: 'file', value: 'src/main.ts' },
    ])
  })

  it('classifies an agent mention (no slash, no dot)', () => {
    expect(parseUserMentions('@coder do it')).toEqual([
      { type: 'mention', kind: 'agent', value: 'coder' },
      { type: 'text', text: ' do it' },
    ])
  })

  it('preserves long trailing text as a single text segment', () => {
    const longBlob = 'x'.repeat(600)
    const input = `看看 @file.py 改一下\n${longBlob}`
    expect(parseUserMentions(input)).toEqual([
      { type: 'text', text: '看看 ' },
      { type: 'mention', kind: 'file', value: 'file.py' },
      { type: 'text', text: ` 改一下\n${longBlob}` },
    ])
  })
})
