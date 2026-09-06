import { describe, expect, it } from 'vitest'
import { completeTypedPath, splitTypedPath } from './use-path-autocomplete'

describe('completing a typed folder path', () => {
  it('lists the folder before the caret and filters by what follows it', () => {
    expect(splitTypedPath('/Users/dev/Dev')).toEqual({ parent: '/Users/dev', prefix: 'Dev' })
    // A trailing slash means the folder itself is the parent and nothing is typed yet.
    expect(splitTypedPath('/Users/dev/')).toEqual({ parent: '/Users/dev', prefix: '' })
  })

  it('treats the filesystem root as its own parent', () => {
    expect(splitTypedPath('/Us')).toEqual({ parent: '/', prefix: 'Us' })
  })

  it('has nothing to list before the first separator', () => {
    expect(splitTypedPath('Users')).toEqual({ parent: '', prefix: 'Users' })
  })

  // The trailing separator is what lets the next keystroke keep completing.
  it('replaces the partial segment and opens the next level', () => {
    expect(completeTypedPath('/Users/dev/Dev', 'Developer')).toBe('/Users/dev/Developer/')
    expect(completeTypedPath('/Users/dev/', 'Developer')).toBe('/Users/dev/Developer/')
  })

  it('reads Windows separators as separators', () => {
    expect(splitTypedPath('C:\\Users\\De')).toEqual({ parent: 'C:/Users', prefix: 'De' })
  })
})
