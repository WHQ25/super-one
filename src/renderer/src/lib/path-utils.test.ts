import { describe, it, expect } from 'vitest'
import { shortenPath, homePath } from './path-utils'

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
