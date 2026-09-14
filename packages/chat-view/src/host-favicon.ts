import { LruMap } from '@superone/shared/lru-map'
import { requestNativeAsync } from './bridge'
import { isHttpHref, type LinkFaviconPorts } from './presenters/LinkFavicon'

/**
 * Icons already answered this document, by origin and scheme — the same key
 * the desktop's own favicon cache uses. Rows re-mount constantly while the
 * transcript scrolls, and a transcript that cites one site ten times must not
 * cross the relay ten times. A host that cannot answer (too old, offline) is
 * remembered as null for the same reason: the globe is the right icon then
 * and retrying on every scroll would only stack up timeouts.
 */
const resolved = new LruMap<string, Promise<string | null>>(200)

function cacheKey(href: string, isDark: boolean): string | null {
  if (!isHttpHref(href)) return null
  return `${new URL(href).origin}#${isDark ? 'dark' : 'light'}`
}

function parseResult(value: unknown): string | null {
  const dataUrl = (value as { dataUrl?: unknown } | null)?.dataUrl
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null
}

export function resolveHostFavicon(href: string, isDark: boolean): Promise<string | null> {
  const key = cacheKey(href, isDark)
  if (!key) return Promise.resolve(null)
  const cached = resolved.get(key)
  if (cached) return cached
  const pending = requestNativeAsync('resolveFavicon', { url: href, isDark }).then(parseResult, () => null)
  resolved.set(key, pending)
  return pending
}

/** Test hook: forget every answer. */
export function resetHostFaviconCache(): void {
  resolved.clear()
}

export const hostFaviconPorts: LinkFaviconPorts = { resolveFavicon: resolveHostFavicon }
