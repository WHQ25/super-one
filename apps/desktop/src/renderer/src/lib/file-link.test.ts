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

  it('never treats http(s) URLs as project files — including localhost', () => {
    expect(
      resolveProjectFileHref('https://localhost/apps/desktop/src/main/mcp/superone-mcp-server.ts', PROJECT),
    ).toBeNull()
    expect(
      resolveProjectFileHref('https://localhost/apps/desktop/src/x.ts#L42', PROJECT),
    ).toBeNull()
    expect(
      resolveProjectFileHref(
        'http://localhost:6006/?path=/story/agentcollaboration-toolui--gallery',
        PROJECT,
      ),
    ).toBeNull()
    expect(resolveProjectFileHref('http://localhost:3000/', PROJECT)).toBeNull()
    expect(resolveProjectFileHref('http://127.0.0.1:5173/src/main.ts', PROJECT)).toBeNull()
    expect(resolveProjectFileHref('https://example.com/docs', PROJECT)).toBeNull()
  })

  it('maps file: URLs under the project root', () => {
    expect(
      resolveProjectFileHref(`file://${PROJECT}/apps/desktop/src/x.ts`, PROJECT),
    ).toEqual({
      filePath: `${PROJECT}/apps/desktop/src/x.ts`,
    })
  })

  it('maps absolute paths outside the project to the editor (not browser)', () => {
    expect(resolveProjectFileHref('/tmp/outside.ts', PROJECT)).toEqual({
      filePath: '/tmp/outside.ts',
    })
    expect(resolveProjectFileHref('/tmp/outside.ts:284', PROJECT)).toEqual({
      filePath: '/tmp/outside.ts',
      lineNumber: 284,
    })
    expect(
      resolveProjectFileHref(
        '/Users/me/other-repo/src/marketplace_policy.rs:284',
        PROJECT,
      ),
    ).toEqual({
      filePath: '/Users/me/other-repo/src/marketplace_policy.rs',
      lineNumber: 284,
    })
  })

  it('maps file: URLs outside the project', () => {
    expect(resolveProjectFileHref('file:///tmp/outside.ts', PROJECT)).toEqual({
      filePath: '/tmp/outside.ts',
    })
  })

  it('maps absolute paths without a project root', () => {
    expect(resolveProjectFileHref('/tmp/outside.ts', '')).toEqual({
      filePath: '/tmp/outside.ts',
    })
  })

  it('rejects relative paths without a project root', () => {
    expect(resolveProjectFileHref('src/x.ts', '')).toBeNull()
  })

  it('maps windows absolute paths outside the project', () => {
    expect(resolveProjectFileHref('C:\\Users\\me\\other\\app.ts:7', PROJECT)).toEqual({
      filePath: 'C:\\Users\\me\\other\\app.ts',
      lineNumber: 7,
    })
  })
})
