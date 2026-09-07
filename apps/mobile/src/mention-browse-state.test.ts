import { describe, expect, it } from 'vitest'
import {
  deriveMentionMode,
  enterDirectoryQuery,
  mentionBreadcrumbs,
  mentionScopeDir,
  resolveBrowsePath,
} from './mention-browse-state'

describe('deriveMentionMode', () => {
  it('browses the project root for a bare @', () => {
    expect(deriveMentionMode('')).toEqual({ kind: 'browse', dir: '' })
  })

  it('browses a directory once the query ends in a separator', () => {
    expect(deriveMentionMode('src/')).toEqual({ kind: 'browse', dir: 'src/' })
    expect(deriveMentionMode('src/ui/')).toEqual({ kind: 'browse', dir: 'src/ui/' })
  })

  it('searches the whole project when nothing scopes it', () => {
    expect(deriveMentionMode('app')).toEqual({ kind: 'search', needle: 'app', scopeDir: '' })
  })

  it('confines the search to the directory already typed', () => {
    expect(deriveMentionMode('src/app')).toEqual({ kind: 'search', needle: 'app', scopeDir: 'src/' })
    expect(deriveMentionMode('src/ui/comp')).toEqual({ kind: 'search', needle: 'comp', scopeDir: 'src/ui/' })
  })
})

describe('mentionScopeDir', () => {
  it('is the same directory in both modes', () => {
    expect(mentionScopeDir('src/')).toBe('src/')
    expect(mentionScopeDir('src/app')).toBe('src/')
    expect(mentionScopeDir('app')).toBe('')
  })
})

describe('mentionBreadcrumbs', () => {
  it('walks back out one segment at a time', () => {
    expect(mentionBreadcrumbs('src/ui/comp')).toEqual([
      { label: 'src', query: 'src/' },
      { label: 'ui', query: 'src/ui/' },
    ])
  })

  it('is empty at the root', () => {
    expect(mentionBreadcrumbs('')).toEqual([])
    expect(mentionBreadcrumbs('app')).toEqual([])
  })
})

describe('enterDirectoryQuery', () => {
  it('appends the child and its separator', () => {
    expect(enterDirectoryQuery('', 'src')).toBe('src/')
    expect(enterDirectoryQuery('src/', 'ui')).toBe('src/ui/')
  })
})

describe('resolveBrowsePath', () => {
  it('joins onto a POSIX root', () => {
    expect(resolveBrowsePath('/work/app', 'src/ui/')).toBe('/work/app/src/ui')
    expect(resolveBrowsePath('/work/app', '')).toBe('/work/app')
  })

  it('keeps a POSIX root that is just the separator', () => {
    expect(resolveBrowsePath('/', 'etc/')).toBe('/etc')
  })

  it('uses the separator a Windows drive root implies', () => {
    expect(resolveBrowsePath('C:\\work\\app', 'src/ui/')).toBe('C:\\work\\app\\src\\ui')
  })

  it('keeps a UNC share root intact', () => {
    expect(resolveBrowsePath('\\\\server\\share', 'src/')).toBe('\\\\server\\share\\src')
  })
})
