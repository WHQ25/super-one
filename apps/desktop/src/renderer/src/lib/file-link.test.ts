import { describe, expect, it } from 'vitest'
import {
  normalizeFileLinkTarget,
  parseFileLinkTarget,
  resolveProjectFileHref,
  safeDecodeFilePath,
} from './file-link'

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

  it('does not decode percent-encoded path separators (Grok session dirs)', () => {
    const grokPath =
      '/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019f/workflows/wf_1/scratch/report.md'
    expect(resolveProjectFileHref(grokPath, PROJECT)).toEqual({ filePath: grokPath })
    // A full decodeURIComponent would turn %2F into extra slashes — must not happen.
    expect(resolveProjectFileHref(grokPath, PROJECT)?.filePath).toContain('%2FUsers%2F')
  })

  it('decodes non-ASCII percent-encoded path segments (CJK filenames)', () => {
    const encoded =
      `${PROJECT}/docs/S-C-%E8%AF%8A%E6%96%ADSQL-%E6%A3%80%E6%9F%A5.md`
    const decoded =
      `${PROJECT}/docs/S-C-诊断SQL-检查.md`
    expect(resolveProjectFileHref(encoded, PROJECT)).toEqual({ filePath: decoded })
    expect(resolveProjectFileHref(`${encoded}#L10`, PROJECT)).toEqual({
      filePath: decoded,
      lineNumber: 10,
    })
  })

  it('decodes CJK segments in project-relative hrefs before joining root', () => {
    expect(resolveProjectFileHref('docs/%E8%AF%8A%E6%96%AD.md', PROJECT)).toEqual({
      filePath: `${PROJECT}/docs/诊断.md`,
    })
  })

  it('decodes CJK in file: URLs without double-breaking', () => {
    const encoded = `file://${PROJECT}/docs/%E8%AF%8A%E6%96%AD.md`
    expect(resolveProjectFileHref(encoded, PROJECT)).toEqual({
      filePath: `${PROJECT}/docs/诊断.md`,
    })
    // Already-decoded file path stays stable.
    expect(
      resolveProjectFileHref(`file://${PROJECT}/docs/诊断.md`, PROJECT),
    ).toEqual({
      filePath: `${PROJECT}/docs/诊断.md`,
    })
  })

  it('keeps already-decoded paths unchanged', () => {
    const path = `${PROJECT}/docs/诊断SQL.md`
    expect(resolveProjectFileHref(path, PROJECT)).toEqual({ filePath: path })
  })

  it('leaves invalid percent sequences unchanged', () => {
    const bad = `${PROJECT}/docs/file%ZZname.md`
    expect(resolveProjectFileHref(bad, PROJECT)).toEqual({ filePath: bad })
  })

  it('expands ~/ paths when homeDir is provided', () => {
    expect(resolveProjectFileHref('~/.grok/workflows/demo.rhai', PROJECT, '/Users/me')).toEqual({
      filePath: '/Users/me/.grok/workflows/demo.rhai',
    })
  })
})

describe('safeDecodeFilePath', () => {
  it('decodes CJK percent-encoding', () => {
    expect(safeDecodeFilePath('/tmp/%E8%AF%8A%E6%96%AD.md')).toBe('/tmp/诊断.md')
  })

  it('does not decode when encoded separators are present', () => {
    const grok = '/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/report.md'
    expect(safeDecodeFilePath(grok)).toBe(grok)
    expect(safeDecodeFilePath('/x/%5CWindows%5Cpath/y')).toBe('/x/%5CWindows%5Cpath/y')
  })

  it('is a no-op for paths without percent escapes', () => {
    expect(safeDecodeFilePath('/tmp/诊断.md')).toBe('/tmp/诊断.md')
    expect(safeDecodeFilePath('/tmp/plain.ts')).toBe('/tmp/plain.ts')
  })

  it('keeps mixed encodings that do not round-trip', () => {
    // Space encoded, CJK already decoded — encodeURI would re-encode CJK.
    const mixed = '/tmp/folder%20name/诊断.md'
    expect(safeDecodeFilePath(mixed)).toBe(mixed)
  })

  it('accepts lowercase hex percent-encoding', () => {
    expect(safeDecodeFilePath('/tmp/%e8%af%8a.md')).toBe('/tmp/诊.md')
  })

  it('documents the literal-%XX filename boundary (indistinguishable from URI encoding)', () => {
    // A file actually named `file%20name.md` round-trips through encodeURI and
    // is decoded to a space — known limitation; not common for CJK workflows.
    expect(safeDecodeFilePath('/tmp/file%20name.md')).toBe('/tmp/file name.md')
  })
})
