import { describe, expect, it } from 'vitest'
import { normalizeFileLinkTarget, parseFileLinkTarget, resolveProjectFileHref } from './file-link'

const PROJECT = '/Users/me/proj'

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

describe('resolveProjectFileHref', () => {
  it('maps absolute paths under the project root', () => {
    expect(resolveProjectFileHref(`${PROJECT}/apps/desktop/src/x.ts`, PROJECT)).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/x.ts`,
    })
  })

  it('maps absolute paths with a line hash', () => {
    expect(resolveProjectFileHref(`${PROJECT}/apps/desktop/src/x.ts#L42`, PROJECT)).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/x.ts`,
      lineNumber: 42,
    })
  })

  it('maps bare project-relative paths', () => {
    expect(resolveProjectFileHref('apps/desktop/src/main/mcp/superone-mcp-server.ts', PROJECT)).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/main/mcp/superone-mcp-server.ts`,
    })
  })

  it('maps ./ relative paths', () => {
    expect(resolveProjectFileHref('./apps/desktop/src/x.ts', PROJECT)).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/x.ts`,
    })
  })

  it('maps rehype-harden defaultOrigin artifacts to project files', () => {
    expect(
      resolveProjectFileHref('https://localhost/apps/desktop/src/main/mcp/superone-mcp-server.ts', PROJECT),
    ).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/main/mcp/superone-mcp-server.ts`,
    })
  })

  it('rejects real external http links', () => {
    expect(resolveProjectFileHref('https://example.com/docs', PROJECT)).toBeNull()
  })

  it('rejects absolute paths outside the project', () => {
    expect(resolveProjectFileHref('/tmp/outside.ts', PROJECT)).toBeNull()
  })
})
