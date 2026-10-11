import { LruMap } from '@superone/shared/lru-map'
import type { MobileRpcClient } from './runtime-session-rpc'

/**
 * Resolving one favicon can cost the desktop an HTML fetch (8 s budget) plus
 * the icon download before its cache is warm, so this waits longer than the
 * client's default.
 */
const FAVICON_TIMEOUT_MS = 20_000

/**
 * Ask the desktop for the favicon its own chat shows in front of `url`. A
 * host too old to know the command never answers and the request times out;
 * that surfaces as null and the link keeps its globe.
 */
export async function requestLinkFavicon(
  client: Pick<MobileRpcClient, 'rpc'>,
  url: string,
  isDark: boolean,
): Promise<string | null> {
  const reply = await client.rpc('environment.favicon', { url, isDark }, { timeoutMs: FAVICON_TIMEOUT_MS }) as { dataUrl?: unknown } | null
  const dataUrl = reply?.dataUrl
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null
}

/** `scheme://host[:port]` of an http(s) URL, lowercased; null for anything else. */
export function linkOrigin(href: string): string | null {
  const match = /^(https?):\/\/(?:[^/?#@]*@)?([^/?#]+)/i.exec(href)
  return match ? `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}` : null
}

/**
 * Answers by origin and scheme — the desktop's own favicon cache key — so a
 * transcript citing a site ten times, or a draft re-rendering on every
 * keystroke, crosses the relay once. A null answer (no icon, an old host that
 * does not know the command) is remembered too: the globe is right then.
 * A failed request (not connected) is not, so it is retried later.
 */
const answered = new LruMap<string, string | null>(200)
const pending = new Map<string, Promise<string | null>>()

function faviconCacheKey(href: string, isDark: boolean): string | null {
  const origin = linkOrigin(href)
  return origin && `${origin}#${isDark ? 'dark' : 'light'}`
}

/** The answer already in hand: a data URL, null for none, undefined when not asked yet. */
export function answeredLinkFavicon(href: string, isDark: boolean): string | null | undefined {
  const key = faviconCacheKey(href, isDark)
  return key ? answered.get(key) : null
}

export function cachedLinkFavicon(
  href: string,
  isDark: boolean,
  resolve: (href: string, isDark: boolean) => Promise<string | null>,
): Promise<string | null> {
  const key = faviconCacheKey(href, isDark)
  if (!key) return Promise.resolve(null)
  if (answered.has(key)) return Promise.resolve(answered.get(key)!)
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const request = resolve(href, isDark).then((dataUrl) => {
    answered.set(key, dataUrl)
    return dataUrl
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

/** Test hook: forget every answer. */
export function resetLinkFaviconCacheForTests(): void {
  answered.clear()
  pending.clear()
}
