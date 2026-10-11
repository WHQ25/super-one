import { describe, expect, it } from 'vitest'
import { findWebLinks, isSingleWebLink } from './web-links'

const hrefs = (text: string) => findWebLinks(text).map((link) => link.href)

describe('findWebLinks', () => {
  it('finds links with their offsets', () => {
    const text = 'see https://example.com/a?b=1#c and http://x.dev'
    expect(findWebLinks(text)).toEqual([
      { start: 4, end: 31, href: 'https://example.com/a?b=1#c' },
      { start: 36, end: 48, href: 'http://x.dev' },
    ])
  })

  it('leaves trailing punctuation and an unopened parenthesis out', () => {
    expect(hrefs('Visit https://example.com.')).toEqual(['https://example.com'])
    expect(hrefs('(see https://example.com/a)')).toEqual(['https://example.com/a'])
    expect(hrefs('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)'])
    expect(hrefs('[docs](https://example.com/docs)')).toEqual(['https://example.com/docs'])
  })

  it('stops at CJK punctuation, quotes and chips', () => {
    expect(hrefs('打开https://example.com/路径，然后')).toEqual(['https://example.com/路径'])
    expect(hrefs('"https://example.com"')).toEqual(['https://example.com'])
    expect(hrefs('https://a.dev￼https://b.dev')).toEqual(['https://a.dev', 'https://b.dev'])
  })

  it('skips a scheme glued to a word and a URL without a host', () => {
    expect(hrefs('xhttps://example.com')).toEqual([])
    expect(hrefs('https:// nothing')).toEqual([])
    expect(hrefs('ftp://example.com')).toEqual([])
  })
})

describe('isSingleWebLink', () => {
  it('accepts one link around whitespace only', () => {
    expect(isSingleWebLink('  https://example.com/a\n')).toBe(true)
    expect(isSingleWebLink(`https://example.com/${'a'.repeat(600)}`)).toBe(true)
    expect(isSingleWebLink('https://example.com.')).toBe(false)
    expect(isSingleWebLink('see https://example.com')).toBe(false)
    expect(isSingleWebLink('https://a.dev https://b.dev')).toBe(false)
  })
})
