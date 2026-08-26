import { describe, expect, it } from 'vitest'
import { baseUrlHasHost, ensureHttpsPrefix, identityKey, siteRootOf } from './site-url'

describe('site-url helpers', () => {
  it('adds https when the value has no scheme', () => {
    expect(ensureHttpsPrefix('api.example.com')).toBe('https://api.example.com')
    expect(ensureHttpsPrefix('https://api.example.com')).toBe('https://api.example.com')
  })

  it('accepts http(s) hosts and rejects empty / invalid input', () => {
    expect(baseUrlHasHost('https://api.example.com')).toBe(true)
    expect(baseUrlHasHost('api.example.com')).toBe(true)
    expect(baseUrlHasHost('')).toBe(false)
    expect(baseUrlHasHost('not a url')).toBe(false)
  })

  it('normalizes a pasted family URL to the site root', () => {
    expect(identityKey('https://api.example.com/v1')).toBe('https://api.example.com')
    expect(siteRootOf('https://api.example.com/v1')).toBe('https://api.example.com')
  })
})
