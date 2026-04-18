import { describe, expect, it } from 'vitest'
import { normalizeFileLinkTarget, parseFileLinkTarget } from './file-link'

describe('parseFileLinkTarget', () => {
  it('parses a colon line suffix', () => {
    expect(parseFileLinkTarget('/tmp/app.ts:12')).toEqual({ filePath: '/tmp/app.ts', lineNumber: 12 })
  })

  it('parses a hash line suffix', () => {
    expect(parseFileLinkTarget('/tmp/app.ts#L34')).toEqual({ filePath: '/tmp/app.ts', lineNumber: 34 })
  })

  it('keeps windows paths intact while parsing the trailing line suffix', () => {
    expect(parseFileLinkTarget('C:\\Users\\me\\app.ts:7')).toEqual({ filePath: 'C:\\Users\\me\\app.ts', lineNumber: 7 })
  })

  it('leaves plain paths unchanged', () => {
    expect(parseFileLinkTarget('/tmp/app.ts')).toEqual({ filePath: '/tmp/app.ts' })
  })
})

describe('normalizeFileLinkTarget', () => {
  it('strips the line suffix from a file target', () => {
    expect(normalizeFileLinkTarget('/tmp/app.ts:12')).toBe('/tmp/app.ts')
  })
})
