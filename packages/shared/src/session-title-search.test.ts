import { describe, expect, it } from 'vitest'
import { MAX_SESSION_SEARCH_PATHS, parseSessionSearchProjectPaths, sessionTitleLikePatterns } from './session-title-search'

describe('sessionTitleLikePatterns', () => {
  it('escapes LIKE metacharacters and walks code points', () => {
    const body = 'a\\%b\\_c\\\\'
    expect(sessionTitleLikePatterns('A%b_c\\')).toEqual({
      prefix: `${body}%`,
      wordPrefix: [' ', '/', '-', '_', '.'].map((separator) => {
        const escaped = separator === '_' ? '\\_' : separator
        return `%${escaped}${body}%`
      }),
      contains: `%${body}%`,
      subsequence: '%a%\\%%b%\\_%c%\\\\%',
    })
    expect(sessionTitleLikePatterns('搜索')).toEqual({
      prefix: '搜索%',
      wordPrefix: ['% 搜索%', '%/搜索%', '%-搜索%', '%\\_搜索%', '%.搜索%'],
      contains: '%搜索%',
      subsequence: '%搜%索%',
    })
    expect(sessionTitleLikePatterns('feat').wordPrefix).toEqual([
      '% feat%', '%/feat%', '%-feat%', '%\\_feat%', '%.feat%',
    ])
  })
})

describe('parseSessionSearchProjectPaths', () => {
  it('treats a missing value as every project', () => {
    expect(parseSessionSearchProjectPaths(undefined)).toBeUndefined()
    expect(parseSessionSearchProjectPaths(null)).toBeUndefined()
  })

  it('keeps a short list of paths and rejects anything else', () => {
    expect(parseSessionSearchProjectPaths(['/work/a', '/work/b'])).toEqual(['/work/a', '/work/b'])
    expect(parseSessionSearchProjectPaths([])).toEqual([])
    expect(parseSessionSearchProjectPaths(Array.from({ length: MAX_SESSION_SEARCH_PATHS + 1 }, (_, i) => `/p/${i}`))).toBeNull()
    expect(parseSessionSearchProjectPaths([''])).toBeNull()
    expect(parseSessionSearchProjectPaths(['/ok', 1])).toBeNull()
    expect(parseSessionSearchProjectPaths(' /work ')).toBeNull()
    expect(parseSessionSearchProjectPaths(['x'.repeat(4097)])).toBeNull()
  })
})
