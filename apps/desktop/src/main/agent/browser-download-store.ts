import { closeSync, mkdirSync, openSync } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { readAppSettings } from '../app-settings-service'
import log from '../logger'

const FALLBACK_DIR = join(tmpdir(), 'super-one-browser-downloads')

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

/** The OS Downloads folder, or a temp dir on the rare platform without one. */
export function systemDownloadDir(): string {
  try {
    return app.getPath('downloads')
  } catch {
    return FALLBACK_DIR
  }
}

/**
 * Where a download should land, in precedence order: the caller's explicit
 * directory, the user's configured default, then the OS Downloads folder.
 * Only absolute paths are honoured — a relative one has no meaningful base in
 * the main process, so it is rejected rather than resolved against cwd.
 */
export function resolveDownloadDir(explicitDir?: string | null): string {
  const explicit = explicitDir?.trim()
  if (explicit) {
    if (!isAbsolute(explicit)) throw new Error(`Download directory must be an absolute path: ${explicit}`)
    return explicit
  }
  return readAppSettings().browserDownloadDir || systemDownloadDir()
}

/**
 * Create the target directory. A directory the agent named explicitly is its
 * responsibility, so a failure surfaces as an error; a failing *configured*
 * default must not break downloading, so it degrades to the OS folder.
 */
function ensureDir(explicitDir?: string | null): string {
  const root = resolveDownloadDir(explicitDir)
  try {
    mkdirSync(root, { recursive: true })
    return root
  } catch (err) {
    if (explicitDir?.trim()) throw err
    log.warn(`[browser-download] cannot use ${root}, falling back: ${err instanceof Error ? err.message : String(err)}`)
  }
  const fallback = systemDownloadDir()
  try {
    mkdirSync(fallback, { recursive: true })
    return fallback
  } catch {
    mkdirSync(FALLBACK_DIR, { recursive: true })
    return FALLBACK_DIR
  }
}

function uniqueCandidate(dir: string, filename: string, attempt: number): string {
  if (attempt === 0) return join(dir, filename)
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  return join(dir, `${stem} (${attempt})${ext}`)
}

/**
 * Reserve an absolute path for a download and return it. Mirrors
 * persistScreenshot's contract: the model gets a path, not bytes. Downloads
 * share one user-visible directory, so the reservation is an exclusive create
 * (`wx`) — that both skips names already on disk and keeps two concurrent
 * downloads of the same file from racing onto the same path.
 */
export function reserveDownloadPath(filename: string, dir?: string | null): string {
  const root = ensureDir(dir)
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = uniqueCandidate(root, filename, attempt)
    try {
      closeSync(openSync(candidate, 'wx'))
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  // 100 same-named files in one folder: stop guessing and make the name unique.
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  return join(root, `${stem} (${randomUUID().slice(0, 8)})${ext}`)
}
