import { describe, expect, it } from 'vitest'
import { extractMentionQuery, insertMention } from './mentions'

describe('extractMentionQuery', () => {
  it('returns the token after a leading or spaced @', () => {
    expect(extractMentionQuery('@fi', 3)).toEqual({ atPosition: 0, query: 'fi' })
    expect(extractMentionQuery('see @src', 8)).toEqual({ atPosition: 4, query: 'src' })
  })

  it('ignores email-like and closed tokens', () => {
    expect(extractMentionQuery('a@b', 3)).toBeNull()
    expect(extractMentionQuery('see @src more', 13)).toBeNull()
    expect(extractMentionQuery('', 0)).toBeNull()
  })

  it('replaces the live token on insert', () => {
    expect(insertMention('@fi', { atPosition: 0, query: 'fi' }, { kind: 'file', path: 'src/a.ts' })).toBe('@src/a.ts ')
  })

  it('leaves a directory query open so browsing can continue', () => {
    expect(insertMention('@sr', { atPosition: 0, query: 'sr' }, { kind: 'dir-entry', path: 'src', isDirectory: true }))
      .toBe('@src/')
  })

  it('writes a bare @ for the project root, never an absolute path', () => {
    // `@/` would browse the filesystem root on the desktop, which is not what
    // tapping the root crumb means.
    expect(insertMention('@src/ui/', { atPosition: 0, query: 'src/ui/' }, { kind: 'dir-entry', path: '', isDirectory: true }))
      .toBe('@')
  })

  it('ends the query when the directory itself is the mention', () => {
    expect(insertMention('@src/u', { atPosition: 0, query: 'src/u' }, { kind: 'directory', path: 'src/ui', isDirectory: true }))
      .toBe('@src/ui ')
  })
})
