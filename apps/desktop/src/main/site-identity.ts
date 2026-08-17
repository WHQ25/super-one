import { parseNewApiStatus, parseSub2ApiPublicSettings, relaySiteRoot } from '@superone/shared/platform-registry'
import { download, toDataUrl } from './image-cache'
import { fetchPageHtml, resolveFavicon } from './favicon'
import log from './logger'

const HTML_TIMEOUT_MS = 8000

export const DEFAULT_CUSTOM_PROVIDER_NAME = 'default'

export interface SiteIdentity {
  name: string | null
  icon: string | null
}

function cleanTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return null
  const cut = t.split(/\s+[|\-–—]\s+/)[0]?.trim()
  return cut || t
}

/** Best-effort site name from a HTML document (`og:site_name`, then `<title>`). */
export function parseHtmlSiteName(html: string): string | null {
  const og =
    html.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:site_name["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i) ??
    html.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:site_name["']/i)
  if (og?.[1]) return cleanTitle(decodeHtmlEntities(og[1]))
  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1]
  return title ? cleanTitle(decodeHtmlEntities(title)) : null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function pageUrlForSite(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return relaySiteRoot(url.toString()) || url.origin
  } catch {
    return null
  }
}

function statusLogo(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const data = (json as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const logo = (data as { logo?: unknown }).logo
  return typeof logo === 'string' && logo.trim() ? logo.trim() : null
}

async function resolveLogo(root: string, logo: string): Promise<string | null> {
  if (logo.startsWith('data:image/')) return logo
  try {
    const url = logo.startsWith('http') ? logo : new URL(logo, `${root}/`).toString()
    const buf = await download(url)
    return buf ? toDataUrl(buf) : null
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Resolve a custom provider's display name + favicon from its site root.
 * Prefers New API / Sub2API panel names, then the HTML title. Favicon uses the
 * shared origin cache. Either field may be null — the caller falls back to `default`.
 */
export async function resolveSiteIdentity(pageUrl: string, isDark: boolean, force = false): Promise<SiteIdentity> {
  const root = pageUrlForSite(pageUrl)
  if (!root) return { name: null, icon: null }

  const [icon, html, statusJson, sub2Json] = await Promise.all([
    resolveFavicon(root, isDark, force),
    fetchPageHtml(root),
    fetchJson(`${root}/api/status`),
    fetchJson(`${root}/api/v1/settings/public`),
  ])

  const sub2 = parseSub2ApiPublicSettings(sub2Json)
  const status = parseNewApiStatus(statusJson)
  const htmlName = html ? parseHtmlSiteName(html) : null
  const name = sub2?.name || status?.name || htmlName || null
  const logo = statusLogo(statusJson)
  const logoIcon = !icon && logo ? await resolveLogo(root, logo) : null
  log.info('[site-identity] root=%s name=%s favicon=%s logo=%s', root, name ?? '(none)', icon ? 'ok' : 'miss', logoIcon ? 'ok' : 'miss')
  return { name, icon: icon ?? logoIcon }
}
