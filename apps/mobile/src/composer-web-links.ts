import { findWebLinks } from '@superone/shared/web-links'
import { linkOrigin } from './link-favicons'
import { webLinkChrome } from './ui/mention-artwork.generated.json'

/** The artwork key of the globe a link shows until (or instead of) its favicon. */
export const WEB_LINK_GLOBE = 'web-link'

export const faviconArtworkKey = (origin: string) => `favicon:${origin}`

/** One bare URL in the draft: its UTF-16 range and the artwork key drawn before it. */
export type WebLinkRange = { start: number; end: number; icon: string }

/**
 * What the native editor paints over a draft's bare URLs, as chat markdown
 * draws a web link (`.web-link`, `LinkFavicon`): link colour and underline, a
 * favicon in front. Purely visual — the draft's text and offsets never change,
 * and the link is not tappable. `eventCount` ties it to the draft it was
 * computed for, like `KeywordHighlight`.
 */
export type LinkHighlight = typeof webLinkChrome & { eventCount: number; links: WebLinkRange[] }

/**
 * The highlight for a native editor snapshot. Its text holds U+FFFC for each
 * chip, which ends a URL, so match offsets are the editor's.
 */
export function linkHighlight(
  snapshot: { text: string; eventCount: number },
  iconFor: (origin: string) => string,
): LinkHighlight {
  const links = findWebLinks(snapshot.text).map(({ start, end, href }) => {
    const origin = linkOrigin(href)
    return { start, end, icon: origin ? iconFor(origin) : WEB_LINK_GLOBE }
  })
  return { ...webLinkChrome, eventCount: snapshot.eventCount, links }
}

/**
 * The base64 image a native editor can decode from a favicon data URL, or null.
 * UIImage and BitmapFactory cannot read SVG, so an SVG favicon keeps the globe.
 */
export function faviconPng(dataUrl: string): string | null {
  const match = /^data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match || /svg/i.test(match[1]!)) return null
  return match[2]!.replace(/\s+/g, '')
}
