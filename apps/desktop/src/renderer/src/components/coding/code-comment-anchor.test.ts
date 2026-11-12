import { describe, expect, it } from 'vitest'
import { codeCommentAnchor, quoteMatchesFile } from './code-comment-anchor'

describe('codeCommentAnchor', () => {
  it('reads a diff quote down to its lines and columns', () => {
    expect(codeCommentAnchor('/proj/src/app.ts:L2-L3:C0-C13:D\n-const b = 2\n+const b = 999')).toEqual({
      filePath: '/proj/src/app.ts',
      lines: [2, 3],
      startCol: 0,
      endCol: 13,
    })
  })

  it('ignores a prose quote', () => {
    expect(codeCommentAnchor('a passage in the reply')).toBeNull()
  })

  it('matches the open file by absolute path, relative path, or suffix', () => {
    expect(quoteMatchesFile('/proj/src/app.ts', '/proj/src/app.ts', 'src/app.ts')).toBe(true)
    expect(quoteMatchesFile('src/app.ts', '/proj/src/app.ts', 'src/app.ts')).toBe(true)
    expect(quoteMatchesFile('/proj/src/other.ts', '/proj/src/app.ts', 'src/app.ts')).toBe(false)
    expect(quoteMatchesFile('/proj/src/app.ts', '/proj/src/app.ts', '')).toBe(true)
  })
})
