import { resolve } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect } from 'vitest'
import { resolveRealPath, isPathWithinAllowed, sanitizeGitRef, isValidBashOutputPath } from './path-security'

describe('resolveRealPath', () => {
  it('resolves relative path to absolute', () => {
    const result = resolveRealPath('.')
    expect(result).toBe(resolve('.'))
  })

  it('returns resolved path when file does not exist', () => {
    const result = resolveRealPath('/nonexistent/path/file.txt')
    expect(result).toBe('/nonexistent/path/file.txt')
  })

  it('resolves absolute path as-is', () => {
    const result = resolveRealPath('/tmp')
    expect(typeof result).toBe('string')
    expect(result.startsWith('/')).toBe(true)
  })
})

describe('isPathWithinAllowed', () => {
  it('allows path within an allowed root', () => {
    expect(isPathWithinAllowed('/projects/myapp/src/file.ts', ['/projects/myapp'])).toBe(true)
  })

  it('allows path within any of multiple roots', () => {
    expect(isPathWithinAllowed('/other/repo/file.ts', ['/projects/myapp', '/other/repo'])).toBe(true)
  })

  it('rejects path outside all allowed roots', () => {
    expect(isPathWithinAllowed('/etc/passwd', ['/projects/myapp'])).toBe(false)
  })

  it('rejects path that is a prefix match but not a child (boundary check)', () => {
    expect(isPathWithinAllowed('/projects/myapp-evil/file.ts', ['/projects/myapp'])).toBe(false)
  })

  it('rejects the root path itself (must be a child)', () => {
    expect(isPathWithinAllowed('/projects/myapp', ['/projects/myapp'])).toBe(false)
  })

  it('rejects when allowed roots is empty', () => {
    expect(isPathWithinAllowed('/any/path', [])).toBe(false)
  })
})

describe('sanitizeGitRef', () => {
  it('passes valid branch names through', () => {
    expect(sanitizeGitRef('main')).toBe('main')
    expect(sanitizeGitRef('feature/my-branch')).toBe('feature/my-branch')
    expect(sanitizeGitRef('v1.0.0')).toBe('v1.0.0')
    expect(sanitizeGitRef('HEAD~1')).toBe('HEAD~1')
  })

  it('throws on dash-prefixed ref (flag injection)', () => {
    expect(() => sanitizeGitRef('--orphan')).toThrow()
    expect(() => sanitizeGitRef('-u')).toThrow()
    expect(() => sanitizeGitRef('--no-verify')).toThrow()
  })

  it('throws on empty string', () => {
    expect(() => sanitizeGitRef('')).toThrow()
  })

  it('throws on control characters', () => {
    expect(() => sanitizeGitRef('branch\x00name')).toThrow()
    expect(() => sanitizeGitRef('branch\nname')).toThrow()
    expect(() => sanitizeGitRef('branch\x7f')).toThrow()
  })

  it('throws on whitespace-only', () => {
    expect(() => sanitizeGitRef('   ')).toThrow()
  })
})

describe('isValidBashOutputPath', () => {
  it('accepts valid .output path in tmpdir', () => {
    const validPath = resolve(tmpdir(), 'some-tool.output')
    expect(isValidBashOutputPath(validPath)).toBe(true)
  })

  it('rejects path with ..', () => {
    expect(isValidBashOutputPath(tmpdir() + '/../etc/passwd.output')).toBe(false)
  })

  it('rejects path without .output suffix', () => {
    expect(isValidBashOutputPath(tmpdir() + '/file.txt')).toBe(false)
  })

  it('rejects path outside tmpdir', () => {
    expect(isValidBashOutputPath('/etc/evil.output')).toBe(false)
  })
})
