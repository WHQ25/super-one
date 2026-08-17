import { describe, expect, it } from 'vitest'
import { pageUrlForSite, parseHtmlSiteName } from './site-identity'

describe('parseHtmlSiteName', () => {
  it('prefers og:site_name over title', () => {
    const html = `
      <html><head>
        <title>Dashboard | Example</title>
        <meta property="og:site_name" content="HiFlowt">
      </head></html>
    `
    expect(parseHtmlSiteName(html)).toBe('HiFlowt')
  })

  it('falls back to the first title segment', () => {
    expect(parseHtmlSiteName('<title>My Relay | New API</title>')).toBe('My Relay')
    expect(parseHtmlSiteName('<title>Console - Admin</title>')).toBe('Console')
  })

  it('returns null when there is no usable title', () => {
    expect(parseHtmlSiteName('<html><body>nope</body></html>')).toBeNull()
    expect(parseHtmlSiteName('<title>   </title>')).toBeNull()
  })
})

describe('pageUrlForSite', () => {
  it('strips /v1 and pasted API suffixes', () => {
    expect(pageUrlForSite('https://relay.com/v1')).toBe('https://relay.com')
    expect(pageUrlForSite('https://relay.com/v1/chat/completions')).toBe('https://relay.com')
  })

  it('adds https when the scheme is missing', () => {
    expect(pageUrlForSite('relay.com/v1')).toBe('https://relay.com')
  })

  it('returns null for empty or non-http values', () => {
    expect(pageUrlForSite('')).toBeNull()
    expect(pageUrlForSite('ftp://relay.com')).toBeNull()
  })
})
