import { describe, it, expect } from 'vitest'
import { shortenPath, homePath, toLocalFileUrl } from './path-utils'

describe('shortenPath', () => {
  it('returns relative path when shortest', () => {
    expect(shortenPath('/Users/alice/project/src/index.ts', '/Users/alice/project', '/Users/alice'))
      .toBe('src/index.ts')
  })

  it('returns home path when no cwd match', () => {
    expect(shortenPath('/Users/alice/other/file.ts', null, '/Users/alice'))
      .toBe('~/other/file.ts')
  })

  it('returns absolute path when shortest', () => {
    expect(shortenPath('/tmp/a.ts', '/Users/alice/project', '/Users/alice'))
      .toBe('/tmp/a.ts')
  })

  it('returns . for exact cwd match', () => {
    expect(shortenPath('/Users/alice/project', '/Users/alice/project', '/Users/alice'))
      .toBe('.')
  })

  it('returns ~ for exact homedir match', () => {
    expect(shortenPath('/Users/alice', '/Users/alice/project', '/Users/alice'))
      .toBe('~')
  })

  it('falls back to regex home detection when no explicit homedir', () => {
    expect(shortenPath('/Users/alice/other/file.ts')).toBe('~/other/file.ts')
  })

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('')
  })

  // Linux
  it('handles Linux home paths', () => {
    expect(shortenPath('/home/bob/project/src/main.rs', '/home/bob/project', '/home/bob'))
      .toBe('src/main.rs')
  })

  it('detects Linux home via regex fallback', () => {
    expect(shortenPath('/home/bob/docs/readme.md')).toBe('~/docs/readme.md')
  })

  // Windows
  it('handles Windows home paths', () => {
    expect(homePath('C:\\Users\\carol\\Documents\\file.txt'))
      .toBe('~\\Documents\\file.txt')
  })
})

describe('homePath', () => {
  it('replaces macOS home dir with ~', () => {
    expect(homePath('/Users/alice/Developer/project')).toBe('~/Developer/project')
  })

  it('replaces Linux home dir with ~', () => {
    expect(homePath('/home/bob/project')).toBe('~/project')
  })

  it('replaces Windows home dir with ~', () => {
    expect(homePath('C:\\Users\\carol\\project')).toBe('~\\project')
  })

  it('leaves non-home paths unchanged', () => {
    expect(homePath('/tmp/file.ts')).toBe('/tmp/file.ts')
  })
})

describe('toLocalFileUrl', () => {
  it('handles macOS/Linux absolute paths', () => {
    expect(toLocalFileUrl('/Users/alice/project/image.png')).toBe('local-file:///Users/alice/project/image.png')
  })

  it('handles Windows drive letter paths with backslashes', () => {
    expect(toLocalFileUrl('C:\\Users\\carol\\project\\image.png')).toBe('local-file:///C:/Users/carol/project/image.png')
  })

  it('handles Windows drive letter paths with forward slashes', () => {
    expect(toLocalFileUrl('C:/Users/carol/project/image.png')).toBe('local-file:///C:/Users/carol/project/image.png')
  })

  it('handles lowercase drive letters', () => {
    expect(toLocalFileUrl('d:\\data\\file.pdf')).toBe('local-file:///d:/data/file.pdf')
  })

  it('encodes percent signs in filenames to prevent unwanted decoding', () => {
    expect(toLocalFileUrl('C:\\Users\\test\\%E4%BC%81%E4%B8%9A.png')).toBe(
      'local-file:///C:/Users/test/%25E4%25BC%2581%25E4%25B8%259A.png',
    )
  })

  it('encodes hash signs in filenames', () => {
    expect(toLocalFileUrl('/Users/alice/file#1.png')).toBe('local-file:///Users/alice/file%231.png')
  })
})
