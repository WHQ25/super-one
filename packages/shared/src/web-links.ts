/** A bare `http(s)://` URL found in prose: `text.slice(start, end) === href`. */
export interface WebLinkMatch {
  start: number
  end: number
  href: string
}

// Whitespace, quotes and angle brackets end a URL, as do the object character a
// composer chip occupies and CJK punctuation (U+3000–U+303F, full-width forms).
const WEB_LINK = /https?:\/\/[^\s<>"'`￼　-〿＀-￯]+/gi
const TRAILING_PUNCTUATION = /[?!.,:;*_~]$/

/**
 * Trims what GFM's autolink extension leaves out of a URL's end: trailing
 * punctuation, and a closing parenthesis the URL itself did not open.
 */
function trimLinkEnd(url: string): string {
  let end = url
  for (;;) {
    if (TRAILING_PUNCTUATION.test(end)) { end = end.slice(0, -1); continue }
    if (end.endsWith(')') && end.split(')').length > end.split('(').length) { end = end.slice(0, -1); continue }
    return end
  }
}

/**
 * Every web link the composer and the sent bubble draw as a link. A scheme
 * glued to an ASCII word (`xhttps://`) is not one, and neither is a URL without a host.
 */
export function findWebLinks(text: string): WebLinkMatch[] {
  const links: WebLinkMatch[] = []
  for (const match of text.matchAll(WEB_LINK)) {
    const start = match.index
    if (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) continue
    const href = trimLinkEnd(match[0])
    if (!/^https?:\/\/[^/?#]+/i.test(href)) continue
    links.push({ start, end: start + href.length, href })
  }
  return links
}

/** Whether `text`, around its whitespace, is exactly one web link. */
export function isSingleWebLink(text: string): boolean {
  const trimmed = text.trim()
  const [link, ...rest] = findWebLinks(trimmed)
  return !!link && rest.length === 0 && link.start === 0 && link.end === trimmed.length
}

/**
 * A page's summary for a link's hover preview, read from its Open Graph tags
 * (with Twitter Card and plain HTML fallbacks). `image` is an absolute URL.
 */
export interface LinkPreview {
  title: string | null
  description: string | null
  siteName: string | null
  image: string | null
}
