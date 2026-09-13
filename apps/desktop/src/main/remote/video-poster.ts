import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import log from '../logger'
import { getMediaServerPort, mediaServerUrl } from '../media-server'

const requireElectron = createRequire(import.meta.url)

/** Longest side of the poster a phone's transcript paints for a video. */
export const VIDEO_POSTER_MAX_SIDE = 512
const POSTER_JPEG_QUALITY = 0.75
/** How far into the clip the frame is taken; the very first frame is often black. */
const POSTER_SEEK_SECONDS = 0.1
/** Decoding a clip's first frame is fast; a stuck decoder should not hold the queue. */
const POSTER_TIMEOUT_MS = 15_000
/** How long the hidden window lives after its last job before it is torn down. */
const WINDOW_IDLE_MS = 30_000
/** On-disk posters kept under userData; oldest go first past this count. */
const DISK_CACHE_LIMIT = 256
const DISK_CACHE_DIRECTORY = 'video-posters'

/** A video's first frame as the phone paints it, plus what the badge shows. */
export interface VideoPoster {
  base64: string
  mimeType: 'image/jpeg'
  width: number
  height: number
  /** Clip length when the container reports one. */
  durationMs?: number
}

/** What the page script hands back — the poster and the dimensions it was cut at. */
interface PosterFrame {
  dataUrl: string
  width: number
  height: number
  duration: number
}

/**
 * The page the hidden window shows: one muted `<video>` streaming from the
 * local media server. `crossorigin` matters — the server answers with CORS
 * headers, and a CORS-approved frame is the only kind a canvas in another
 * origin (this `data:` page) may read back. Without it `toDataURL` throws.
 */
function posterPage(sourceUrl: string): string {
  const escaped = sourceUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">`
    + `<video crossorigin="anonymous" muted preload="auto" src="${escaped}"></video>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * Runs inside the hidden window. Waits for the first frame to be decodable,
 * seeks past the (often black) first frame, and draws it onto a canvas scaled
 * to the poster size. Errors reject with the media element's code so the log
 * says why.
 */
function posterScript(maxSide: number, seekSeconds: number, quality: number): string {
  return `new Promise((resolve, reject) => {
    const video = document.querySelector('video')
    if (!video) { reject(new Error('no media element')); return }
    video.muted = true
    video.pause()
    const fail = () => reject(new Error('media error ' + (video.error ? video.error.code : 'unknown')))
    const capture = () => {
      const width = video.videoWidth, height = video.videoHeight
      if (!width || !height) { reject(new Error('no video track')); return }
      const scale = Math.min(1, ${maxSide} / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', ${quality}), width: canvas.width, height: canvas.height, duration: video.duration })
    }
    const seek = () => {
      const target = Number.isFinite(video.duration) ? Math.min(${seekSeconds}, video.duration / 2) : 0
      if (target <= 0 || video.currentTime >= target) { capture(); return }
      video.addEventListener('seeked', capture, { once: true })
      video.currentTime = target
    }
    video.addEventListener('error', fail, { once: true })
    if (video.readyState >= 2) seek()
    else video.addEventListener('loadeddata', seek, { once: true })
  })`
}

type PosterWindow = import('electron').BrowserWindow

interface PosterRenderer {
  render(realPath: string): Promise<VideoPoster | null>
}

/** Where the hidden window streams the clip from; `null` until the media server is up. */
function defaultSourceUrl(realPath: string): string | null {
  const port = getMediaServerPort()
  return port > 0 ? mediaServerUrl(realPath, port) : null
}

/**
 * A hidden, offscreen Chromium window that decodes the clip the way the
 * desktop's own `<video>` tile does, streaming it from the same local media
 * server. Main has no decoder of its own and bundling ffmpeg for one frame is
 * not worth its weight; Chromium already ships the H.264/VP9/AV1 decoders the
 * desktop plays with. Jobs run one at a time — a poster is cut once per file
 * and then cached, so throughput does not matter and a single window keeps
 * memory flat.
 */
function createWindowRenderer(sourceUrl: (realPath: string) => string | null = defaultSourceUrl): PosterRenderer {
  const { BrowserWindow } = requireElectron('electron') as typeof import('electron')
  let window: PosterWindow | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const dispose = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (window && !window.isDestroyed()) window.destroy()
    window = null
  }

  const acquire = (): PosterWindow => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        show: false,
        width: VIDEO_POSTER_MAX_SIDE,
        height: VIDEO_POSTER_MAX_SIDE,
        webPreferences: {
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      })
      // Nothing in the page may leave it; the clip is the whole world.
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.setAudioMuted(true)
    }
    return window
  }

  const release = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(dispose, WINDOW_IDLE_MS)
  }

  const renderOnce = async (realPath: string): Promise<VideoPoster | null> => {
    const source = sourceUrl(realPath)
    if (!source) {
      log.warn('[video-poster] %s: media server not running', realPath)
      return null
    }
    const win = acquire()
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      const frame = await Promise.race([
        (async () => {
          await win.loadURL(posterPage(source))
          return await win.webContents.executeJavaScript(
            posterScript(VIDEO_POSTER_MAX_SIDE, POSTER_SEEK_SECONDS, POSTER_JPEG_QUALITY),
            true,
          ) as PosterFrame
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('poster timed out')), POSTER_TIMEOUT_MS)
        }),
      ])
      const comma = frame.dataUrl.indexOf(',')
      if (!frame.dataUrl.startsWith('data:image/jpeg') || comma < 0) return null
      return {
        base64: frame.dataUrl.slice(comma + 1),
        mimeType: 'image/jpeg',
        width: frame.width,
        height: frame.height,
        ...(Number.isFinite(frame.duration) && frame.duration > 0 ? { durationMs: Math.round(frame.duration * 1000) } : {}),
      }
    } catch (err) {
      log.warn('[video-poster] %s: %s', realPath, (err as Error).message)
      // A decoder that timed out may never recover; start the next job clean.
      dispose()
      return null
    } finally {
      if (timer) clearTimeout(timer)
      release()
    }
  }

  return {
    render(realPath) {
      const job = queue.then(() => renderOnce(realPath))
      queue = job.catch(() => undefined)
      return job
    },
  }
}

/**
 * Posters already cut, on disk under userData, keyed by path, size and
 * mtime. History is re-sent on every open and reconnect, and the phone
 * forgets its copies on disconnect; a poster is a decode we only want to pay
 * once per file version.
 */
function createDiskCache(directory: string) {
  const keyFor = (realPath: string, size: number, modifiedAt: number) =>
    createHash('sha1').update(`${realPath}\0${size}\0${modifiedAt}`).digest('hex')

  const prune = () => {
    let entries: { name: string; mtimeMs: number }[]
    try {
      entries = readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, mtimeMs: statSync(join(directory, name)).mtimeMs }))
    } catch {
      return
    }
    if (entries.length <= DISK_CACHE_LIMIT) return
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of entries.slice(0, entries.length - DISK_CACHE_LIMIT)) {
      try { unlinkSync(join(directory, entry.name)) } catch { /* already gone */ }
    }
  }

  return {
    read(realPath: string, size: number, modifiedAt: number): VideoPoster | null | undefined {
      try {
        const parsed = JSON.parse(readFileSync(join(directory, `${keyFor(realPath, size, modifiedAt)}.json`), 'utf8')) as { poster: VideoPoster | null }
        return parsed.poster
      } catch {
        return undefined
      }
    },
    write(realPath: string, size: number, modifiedAt: number, poster: VideoPoster | null): void {
      try {
        mkdirSync(directory, { recursive: true })
        writeFileSync(join(directory, `${keyFor(realPath, size, modifiedAt)}.json`), JSON.stringify({ poster }))
        prune()
      } catch (err) {
        log.warn('[video-poster] cache write failed: %s', (err as Error).message)
      }
    },
  }
}

export interface VideoPosterService {
  /** The poster for a video already authorized by the caller, or `null` when it cannot be decoded. */
  posterFor(file: { realPath: string; size: number; modifiedAt: number }): Promise<VideoPoster | null>
}

export function createVideoPosterService(
  options: { cacheDirectory: string; renderer?: PosterRenderer; sourceUrl?: (realPath: string) => string | null },
): VideoPosterService {
  const cache = createDiskCache(options.cacheDirectory)
  let renderer = options.renderer ?? null
  const inflight = new Map<string, Promise<VideoPoster | null>>()
  return {
    posterFor(file) {
      const cached = cache.read(file.realPath, file.size, file.modifiedAt)
      if (cached !== undefined) return Promise.resolve(cached)
      const key = `${file.realPath}\0${file.size}\0${file.modifiedAt}`
      const pending = inflight.get(key)
      if (pending) return pending
      const job = (renderer ??= createWindowRenderer(options.sourceUrl)).render(file.realPath)
        .then((poster) => {
          cache.write(file.realPath, file.size, file.modifiedAt, poster)
          return poster
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, job)
      return job
    },
  }
}

let defaultService: VideoPosterService | null = null

/** The app-wide service, cached under userData. */
export function videoPosterService(): VideoPosterService {
  if (!defaultService) {
    const { app } = requireElectron('electron') as typeof import('electron')
    defaultService = createVideoPosterService({ cacheDirectory: join(app.getPath('userData'), DISK_CACHE_DIRECTORY) })
  }
  return defaultService
}
