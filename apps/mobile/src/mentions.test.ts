import { describe, expect, it } from 'vitest'
import { directoryNavigationItem, extractMentionQuery, insertMention } from './mentions'

describe('extractMentionQuery', () => {
  it('keeps the portal query open across the spaces its grammar needs', () => {
    // `@session <project> <title>` is three tokens by design; closing at the
    // first space would make the portal unreachable.
    expect(extractMentionQuery('@session all mention popup', 26))
      .toEqual({ atPosition: 0, query: 'session all mention popup' })
    expect(extractMentionQuery('look at @session super-one align', 32))
      .toEqual({ atPosition: 8, query: 'session super-one align' })
  })

  it('still closes an ordinary mention at the first space', () => {
    expect(extractMentionQuery('@src/a.ts and more', 18)).toBeNull()
  })

  it('does not let a portal query span a line break', () => {
    expect(extractMentionQuery('@session all\nnext line', 22)).toBeNull()
  })

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

  it('leaves a waypoint query open so browsing can continue', () => {
    expect(insertMention('@sr', { atPosition: 0, query: 'sr' }, directoryNavigationItem('src'))).toBe('@src/')
    expect(insertMention('@ses', { atPosition: 0, query: 'ses' }, { kind: 'session-project', path: 'all', navigateTo: 'session all ' }))
      .toBe('@session all ')
  })

  it('writes a bare @ for the project root, never an absolute path', () => {
    // `@/` would browse the filesystem root on the desktop, which is not what
    // tapping the root crumb means.
    expect(insertMention('@src/ui/', { atPosition: 0, query: 'src/ui/' }, directoryNavigationItem('')))
      .toBe('@')
  })

  it('ends the query when the directory itself is the mention', () => {
    expect(insertMention('@src/u', { atPosition: 0, query: 'src/u' }, { kind: 'directory', path: 'src/ui', isDirectory: true }))
      .toBe('@src/ui ')
  })
})
