import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from './logger'
import { download, toDataUrl } from './image-cache'

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000
const HTML_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 200_000
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function cacheDir(): string {
  return join(app.getPath('userData'), 'favicon-cache')
}

function writeCache(filePath: string, buf: Buffer): void {
  mkdirSync(cacheDir(), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, buf)
  renameSync(tmp, filePath)
}

async function fetchHtml(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null
    return (await res.text()).slice(0, MAX_HTML_BYTES)
  } catch {
    return null
  }
}

function parseIconCandidates(html: string, pageUrl: string, isDark: boolean): string[] {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length)
  const candidates: Array<{ url: string; priority: number; size: number; schemeScore: number }> = []
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase() ?? ''
    if (!rel.includes('icon')) continue
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const sizes = tag.match(/\bsizes\s*=\s*["']([^"']+)["']/i)?.[1] ?? ''
    const size = /svg/i.test(href) ? 9999 : parseInt(sizes, 10) || 0
    const priority = rel.includes('apple') ? 2 : rel === 'icon' || rel.includes('shortcut') ? 0 : 1
    const media = tag.match(/\bmedia\s*=\s*["']([^"']+)["']/i)?.[1].toLowerCase() ?? ''
    const scheme = /prefers-color-scheme\s*:\s*dark/.test(media)
      ? 'dark'
      : /prefers-color-scheme\s*:\s*light/.test(media)
        ? 'light'
        : 'neutral'
    const schemeScore = scheme === 'neutral' ? 1 : scheme === (isDark ? 'dark' : 'light') ? 2 : 0
    try {
      candidates.push({ url: new URL(href, pageUrl).toString(), priority, size, schemeScore })
    } catch {
      // ignore malformed href
    }
  }
  candidates.sort((a, b) => b.schemeScore - a.schemeScore || a.priority - b.priority || b.size - a.size)
  return candidates.map((c) => c.url)
}

function googleFaviconUrl(pageUrl: string): string {
  return `https://t0.gstatic.com/faviconV2?client=chrome&nfrp=2&check_seen=true&size=64&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(pageUrl)}`
}

async function resolveAndDownload(pageUrl: string, origin: string, isDark: boolean): Promise<Buffer | null> {
  const seen = new Set<string>()
  const candidates: string[] = []
  const html = await fetchHtml(pageUrl)
  if (html) candidates.push(...parseIconCandidates(html, pageUrl, isDark))
  candidates.push(`${origin}/favicon.ico`)
  candidates.push(googleFaviconUrl(pageUrl))
  for (const url of candidates) {
    if (seen.has(url)) continue
    seen.add(url)
    const buf = await download(url)
    if (buf) return buf
  }
  return null
}

function cacheFileFor(origin: string, isDark: boolean): string {
  const cacheKey = createHash('sha256').update(`${origin}#${isDark ? 'dark' : 'light'}`).digest('hex')
  return join(cacheDir(), cacheKey)
}

/**
 * Primes the shared favicon cache from an icon the in-app browser captured live
 * (webview `page-favicon-updated`). This links the browser to chat markdown links
 * and bookmarks: they all read the same origin-keyed cache, so opening a page
 * refreshes the icon everywhere and nothing re-resolves it from scratch.
 */
export async function cacheCapturedFavicon(pageUrl: string, faviconUrl: string, isDark: boolean): Promise<void> {
  if (!/^https?:\/\//i.test(pageUrl) || !/^https?:\/\//i.test(faviconUrl)) return
  let origin: string
  try {
    origin = new URL(pageUrl).origin
  } catch {
    return
  }
  try {
    const buf = await download(faviconUrl)
    if (buf) writeCache(cacheFileFor(origin, isDark), buf)
  } catch (err) {
    log.debug('[favicon] cache-from-capture failed:', err)
  }
}

const refreshing = new Set<string>()

async function refreshInBackground(pageUrl: string, origin: string, isDark: boolean, filePath: string): Promise<void> {
  if (refreshing.has(filePath)) return
  refreshing.add(filePath)
  try {
    const buf = await resolveAndDownload(pageUrl, origin, isDark)
    if (buf) writeCache(filePath, buf)
  } catch (err) {
    log.debug('[favicon] background refresh failed:', err)
  } finally {
    refreshing.delete(filePath)
  }
}

/**
 * Resolves a page URL's favicon the way Chromium does — fetch the HTML, read the
 * declared `<link rel="icon">` (preferring the `media` variant matching the app
 * theme, falling back to `/favicon.ico`), download the original icon — and returns
 * it as a data URL. Keyed by origin + theme, disk-cached for 3 days with background
 * refresh past the TTL. Returns null on any failure.
 */
export async function resolveFavicon(pageUrl: string, isDark: boolean): Promise<string | null> {
  if (!/^https?:\/\//i.test(pageUrl)) return null
  let origin: string
  try {
    origin = new URL(pageUrl).origin
  } catch {
    return null
  }
  const filePath = cacheFileFor(origin, isDark)

  if (existsSync(filePath)) {
    try {
      const dataUrl = toDataUrl(readFileSync(filePath))
      if (dataUrl) {
        if (Date.now() - statSync(filePath).mtimeMs > CACHE_TTL_MS) {
          void refreshInBackground(pageUrl, origin, isDark, filePath)
        }
        return dataUrl
      }
    } catch (err) {
      log.debug('[favicon] read failed:', err)
    }
  }

  const buf = await resolveAndDownload(pageUrl, origin, isDark)
  if (!buf) return null
  try {
    writeCache(filePath, buf)
  } catch (err) {
    log.debug('[favicon] write failed:', err)
  }
  return toDataUrl(buf)
}
