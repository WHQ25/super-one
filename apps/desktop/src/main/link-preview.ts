import { LruMap } from '@superone/shared/lru-map'
import type { LinkPreview } from '@superone/shared/web-links'
import { fetchPageHtml } from './favicon'
import { readHtmlMeta, readHtmlTitle } from './html-meta'

const MAX_TITLE_CHARS = 200
const MAX_DESCRIPTION_CHARS = 400

/** Hovering the same link again (or its twin elsewhere in the chat) must not refetch the page. */
const previews = new LruMap<string, Promise<LinkPreview | null>>(200)

function clip(value: string | undefined | null, max: number): string | null {
  if (!value) return null
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : value
}

function absoluteHttpUrl(value: string | undefined, base: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * A page's summary from the Open Graph protocol (ogp.me), the tags link
 * unfurlers read, falling back to Twitter Card tags and then plain
 * `<title>` / `<meta name="description">`. Null when the page has none.
 */
export function parseLinkPreview(html: string, pageUrl: string): LinkPreview | null {
  const meta = readHtmlMeta(html)
  const pick = (...keys: string[]) => keys.map((key) => meta.get(key)).find(Boolean)
  const preview: LinkPreview = {
    title: clip(pick('og:title', 'twitter:title') ?? readHtmlTitle(html), MAX_TITLE_CHARS),
    description: clip(pick('og:description', 'twitter:description', 'description'), MAX_DESCRIPTION_CHARS),
    siteName: clip(pick('og:site_name', 'application-name'), MAX_TITLE_CHARS),
    image: absoluteHttpUrl(pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), pageUrl),
  }
  return preview.title || preview.description || preview.image ? preview : null
}

export function resolveLinkPreview(pageUrl: string): Promise<LinkPreview | null> {
  if (!/^https?:\/\//i.test(pageUrl)) return Promise.resolve(null)
  const cached = previews.get(pageUrl)
  if (cached) return cached
  const pending = fetchPageHtml(pageUrl).then((html) => (html ? parseLinkPreview(html, pageUrl) : null))
  previews.set(pageUrl, pending)
  return pending
}
