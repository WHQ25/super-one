import { mkdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const DOWNLOAD_DIR = join(tmpdir(), 'super-one-browser-downloads')

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'text/plain': 'txt',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'application/octet-stream': 'bin',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

const RESERVED_FILENAME_CHARS = /[/\\:*?"<>|]/g

function extForMime(mimeType: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase()
  if (MIME_EXT[mime]) return MIME_EXT[mime]
  const sub = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/g, '')
  return sub || 'bin'
}

// basename() strips any traversal a hostile Content-Disposition or URL path
// could smuggle in; the rest are characters no filesystem should have to take.
function sanitize(name: string): string {
  const printable = Array.from(basename(name))
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
  const base = printable.replace(RESERVED_FILENAME_CHARS, '_').trim()
  if (!base || base === '.' || base === '..') return ''
  return base.slice(0, 120)
}

export function filenameFor(rawName: string, url: string, mimeType: string): string {
  const ext = extForMime(mimeType)
  let name = sanitize(rawName)
  if (!name && !url.startsWith('data:')) {
    try {
      name = sanitize(decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''))
    } catch {
      name = ''
    }
  }
  if (!name) return `download.${ext}`
  return extname(name) ? name : `${name}.${ext}`
}

/**
 * Reserve an absolute path for a download and return it. Mirrors
 * persistScreenshot's contract: the model gets a path, not bytes. Each download
 * lands in its own uuid subdir so the site's real filename survives verbatim
 * without any collision handling.
 */
export function reserveDownloadPath(filename: string): string {
  const dir = join(DOWNLOAD_DIR, randomUUID())
  mkdirSync(dir, { recursive: true })
  return join(dir, filename)
}
