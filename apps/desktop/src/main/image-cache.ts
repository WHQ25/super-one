import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from './logger'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 15000

function cacheDir(): string {
  return join(app.getPath('userData'), 'image-cache')
}

export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  // ICO (type 1) and CUR (type 2) share the same container.
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) return 'image/x-icon'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp'
  const head = buf.subarray(0, 256).toString('utf8').trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml'
  return null
}

/**
 * Pull the largest PNG payload out of an ICO/CUR. Modern favicons embed PNG
 * frames; a BMP-only icon returns null so the caller can try the next source
 * (Chromium paints ICO, WKWebView's `<img>` / `Image()` does not).
 */
export function extractPngFromIco(buf: Buffer): Buffer | null {
  if (buf.length < 6) return null
  const count = buf.readUInt16LE(4)
  if (count <= 0 || count > 64) return null
  let best: Buffer | null = null
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16
    if (entry + 16 > buf.length) return best
    const size = buf.readUInt32LE(entry + 8)
    const offset = buf.readUInt32LE(entry + 12)
    if (!size || offset < 0 || offset + size > buf.length) continue
    const slice = buf.subarray(offset, offset + size)
    if (slice.length >= 4 && slice[0] === 0x89 && slice[1] === 0x50 && slice[2] === 0x4e && slice[3] === 0x47) {
      if (!best || slice.length > best.length) best = Buffer.from(slice)
    }
  }
  return best
}

/**
 * Bytes a chat WebView can actually paint. ICO is accepted on desktop Chromium
 * and rejected by WKWebView, so an ICO without an embedded PNG is dropped.
 */
export function toWebDisplayImage(buf: Buffer): Buffer | null {
  const mime = detectImageMime(buf)
  if (!mime) return null
  if (mime === 'image/x-icon') return extractPngFromIco(buf)
  return buf
}

export function toDataUrl(buf: Buffer): string | null {
  const display = toWebDisplayImage(buf)
  if (!display) return null
  const mime = detectImageMime(display)
  if (!mime || mime === 'image/x-icon') return null
  return `data:${mime};base64,${display.toString('base64')}`
}

export async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && detectImageMime(buf) ? buf : null
  } catch {
    return null
  }
}

function writeCache(filePath: string, buf: Buffer): void {
  mkdirSync(cacheDir(), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  writeFileSync(tmp, buf)
  renameSync(tmp, filePath)
}

const refreshing = new Set<string>()

async function refreshInBackground(url: string, filePath: string): Promise<void> {
  if (refreshing.has(url)) return
  refreshing.add(url)
  try {
    const buf = await download(url)
    if (buf) writeCache(filePath, buf)
  } catch (err) {
    log.debug('[image-cache] background refresh failed:', err)
  } finally {
    refreshing.delete(url)
  }
}

/**
 * Returns a persistent, disk-cached remote image as a data URL.
 * Serves the cached copy instantly; re-downloads in the background once the
 * cache is older than the TTL. Returns null on any failure.
 */
export async function cacheRemoteImage(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const key = createHash('sha256').update(url).digest('hex')
  const filePath = join(cacheDir(), key)

  if (existsSync(filePath)) {
    try {
      const dataUrl = toDataUrl(readFileSync(filePath))
      if (dataUrl) {
        if (Date.now() - statSync(filePath).mtimeMs > CACHE_TTL_MS) {
          void refreshInBackground(url, filePath)
        }
        return dataUrl
      }
    } catch (err) {
      log.debug('[image-cache] read failed:', err)
    }
  }

  const buf = await download(url)
  if (!buf) return null
  try {
    writeCache(filePath, buf)
  } catch (err) {
    log.debug('[image-cache] write failed:', err)
  }
  return toDataUrl(buf)
}
