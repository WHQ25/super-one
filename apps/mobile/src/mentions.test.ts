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
})
