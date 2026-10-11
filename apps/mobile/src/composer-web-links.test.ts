import { describe, expect, it } from 'vitest'
import { WEB_LINK_GLOBE, faviconArtworkKey, faviconPng, linkHighlight } from './composer-web-links'
import data from './ui/mention-artwork.generated.json'

describe('linkHighlight', () => {
  it('ranges each bare URL at its editor offset, a chip ending it', () => {
    const text = 'see https://example.com/a, and ￼ http://x.dev/q?p=1￼'
    const highlight = linkHighlight({ text, eventCount: 4 }, (origin) => origin === 'https://example.com' ? faviconArtworkKey(origin) : WEB_LINK_GLOBE)
    expect(highlight).toMatchObject({ eventCount: 4, ...data.webLinkChrome })
    expect(highlight.links).toEqual([
      { start: 4, end: 25, icon: 'favicon:https://example.com' },
      { start: 33, end: 51, icon: WEB_LINK_GLOBE },
    ])
    expect(text.slice(4, 25)).toBe('https://example.com/a')
    expect(text.slice(33, 51)).toBe('http://x.dev/q?p=1')
  })

  it('paints nothing for a draft without links', () => {
    expect(linkHighlight({ text: 'no links here, xhttps://a.b', eventCount: 1 }, () => 'x').links).toEqual([])
  })

  it('takes the desktop link colour and favicon geometry', () => {
    expect(data.webLinkChrome).toEqual({ color: '#3a93e6', alpha: 0.7, underline: false, iconSizeEm: 0.9, iconGapEm: 0.25, iconBaselineEm: 0.1 })
    expect(data.glyphs['web-link'].icon).toBe('Globe')
  })
})

describe('faviconPng', () => {
  it('passes raster base64 through and keeps the globe for SVG or non-base64', () => {
    expect(faviconPng('data:image/png;base64,iVBOR\nw==')).toBe('iVBORw==')
    expect(faviconPng('data:image/x-icon;base64,AAAB')).toBe('AAAB')
    expect(faviconPng('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(faviconPng('data:image/svg+xml;utf8,<svg/>')).toBeNull()
    expect(faviconPng('https://example.com/favicon.ico')).toBeNull()
  })
})
