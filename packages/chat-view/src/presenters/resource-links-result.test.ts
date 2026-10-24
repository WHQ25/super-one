import { describe, expect, it } from 'vitest'
import { fileUriPath } from './ResourceLinksResult'

describe('fileUriPath', () => {
  it('reads the local path a file URI names', () => {
    expect(fileUriPath('file:///Users/me/My%20Report.pdf')).toBe('/Users/me/My Report.pdf')
    expect(fileUriPath('file:///C:/Users/me/q4.pdf')).toBe('C:/Users/me/q4.pdf')
  })

  it('leaves other schemes to the caller', () => {
    expect(fileUriPath('https://example.com/q4.pdf')).toBeNull()
    expect(fileUriPath('reports://q4/summary')).toBeNull()
  })
})
