/**
 * Resumable HTTP download for harness tarballs (CLI + desktop).
 *
 * - Durable partial at `destPath` + `Range: bytes=N-`
 * - Hash while streaming (sha256 + sha512)
 * - Serialize concurrent writers on the same path
 * - Keep partial on failure so the next enable can continue
 */

import { createHash, type Hash } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import type { DownloadToFile, DownloadToFileResult, HttpFetch } from './tarball-fetch'

export const HARNESS_PROGRESS_THROTTLE_MS = 200

export type ResumableLog = {
  info?: (msg: string) => void
  warn?: (msg: string) => void
}

/** Throttle progress callbacks so multi‑MB downloads do not flood IPC/UI. */
export function createThrottledProgress(
  onProgress: ((received: number, total: number) => void) | undefined,
  throttleMs = HARNESS_PROGRESS_THROTTLE_MS,
): ((received: number, total: number) => void) | undefined {
  if (!onProgress) return undefined
  let lastEmit = 0
  return (received, total) => {
    const now = Date.now()
    const done = total > 0 && received >= total
    if (done || lastEmit === 0 || now - lastEmit >= throttleMs) {
      lastEmit = now
      onProgress(received, total)
    }
  }
}

/** Parse `Content-Range: bytes start-end/total` (total may be `*`). */
export function parseContentRange(
  header: string | null,
): { start: number; end: number; total: number | null } | null {
  if (!header) return null
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim())
  if (!m) return null
  return {
    start: Number(m[1]),
    end: Number(m[2]),
    total: m[3] === '*' ? null : Number(m[3]),
  }
}

async function seedHashesFromFile(
  path: string,
): Promise<{ sha256: Hash; sha512: Hash; size: number }> {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  const size = statSync(path).size
  if (size === 0) return { sha256, sha512, size }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      sha256.update(buf)
      sha512.update(buf)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return { sha256, sha512, size }
}

export async function hashExistingFile(
  path: string,
  onProgress?: (received: number, total: number) => void,
): Promise<DownloadToFileResult> {
  const { sha256, sha512, size } = await seedHashesFromFile(path)
  onProgress?.(size, size)
  return {
    byteLength: size,
    sha256Hex: sha256.digest('hex'),
    sha512Base64: sha512.digest('base64'),
  }
}

export interface StreamToFileOptions {
  resumeFrom?: number
  totalBytes?: number
  append?: boolean
  keepPartialOnError?: boolean
  progressThrottleMs?: number
}

/**
 * Stream a Response body to disk while computing sha256 + sha512.
 * Supports append resume when `resumeFrom` > 0.
 */
export async function streamResponseToFile(
  res: Response,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
  opts: StreamToFileOptions = {},
): Promise<DownloadToFileResult> {
  if (!res.ok && res.status !== 206) {
    throw new Error(`tarball GET → ${res.status}`)
  }
  const resumeFrom = opts.resumeFrom ?? 0
  const append = opts.append === true && resumeFrom > 0
  const keepPartial = opts.keepPartialOnError !== false
  const contentLen = Number(res.headers.get('content-length') ?? 0)
  const total =
    opts.totalBytes && opts.totalBytes > 0
      ? opts.totalBytes
      : append
        ? resumeFrom + contentLen
        : contentLen

  mkdirSync(dirname(destPath), { recursive: true })
  const emit = createThrottledProgress(onProgress, opts.progressThrottleMs)

  let sha256: Hash
  let sha512: Hash
  let received: number

  if (append) {
    const seeded = await seedHashesFromFile(destPath)
    if (seeded.size !== resumeFrom) {
      throw new Error(
        `partial size mismatch: disk=${seeded.size} resumeFrom=${resumeFrom}`,
      )
    }
    sha256 = seeded.sha256
    sha512 = seeded.sha512
    received = resumeFrom
    emit?.(received, total || received)
  } else {
    sha256 = createHash('sha256')
    sha512 = createHash('sha512')
    received = 0
  }

  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (append) {
      appendFileSync(destPath, buf)
    } else {
      writeFileSync(destPath, buf)
    }
    sha256.update(buf)
    sha512.update(buf)
    received += buf.byteLength
    emit?.(received, total || received)
    onProgress?.(received, total || received)
    return {
      byteLength: received,
      sha256Hex: sha256.digest('hex'),
      sha512Base64: sha512.digest('base64'),
    }
  }

  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sha256.update(chunk)
      sha512.update(chunk)
      received += chunk.byteLength
      emit?.(received, total || received)
      cb(null, chunk)
    },
  })

  try {
    await pipeline(
      nodeStream,
      hasher,
      createWriteStream(destPath, append ? { flags: 'a' } : undefined),
    )
  } catch (err) {
    if (!keepPartial) {
      try {
        if (existsSync(destPath)) rmSync(destPath, { force: true })
      } catch {
        /* best-effort */
      }
    }
    throw err
  }

  onProgress?.(received, total || received)
  return {
    byteLength: received,
    sha256Hex: sha256.digest('hex'),
    sha512Base64: sha512.digest('base64'),
  }
}

/** Serialize writers that share a durable partial path. */
const destPathLocks = new Map<string, Promise<void>>()

async function withDestPathLock<T>(destPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = destPathLocks.get(destPath) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const held = prev.then(() => gate)
  destPathLocks.set(
    destPath,
    held.catch(() => {
      /* never reject the chain */
    }),
  )
  await prev.catch(() => {
    /* previous holder failed — still our turn */
  })
  try {
    return await fn()
  } finally {
    release()
    if (destPathLocks.get(destPath) === held) {
      destPathLocks.delete(destPath)
    }
  }
}

/** Test helper: drop in-process path locks between cases. */
export function resetDestPathLocksForTests(): void {
  destPathLocks.clear()
}

/**
 * Resumable download: reuses `destPath` via `Range: bytes=N-`.
 * Partial kept on failure; caller deletes after successful install.
 */
export async function downloadResumableToFile(
  httpFetch: HttpFetch,
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
  log?: ResumableLog,
): Promise<DownloadToFileResult> {
  return withDestPathLock(destPath, () =>
    downloadResumableToFileUnlocked(httpFetch, url, destPath, onProgress, log),
  )
}

async function downloadResumableToFileUnlocked(
  httpFetch: HttpFetch,
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
  log?: ResumableLog,
): Promise<DownloadToFileResult> {
  mkdirSync(dirname(destPath), { recursive: true })
  let existing = existsSync(destPath) ? statSync(destPath).size : 0

  if (existing > 0 && existing < 64) {
    rmSync(destPath, { force: true })
    existing = 0
  }

  const tryOnce = async (from: number): Promise<DownloadToFileResult> => {
    const diskNow = existsSync(destPath) ? statSync(destPath).size : 0
    const start = from > 0 ? diskNow : 0
    if (from > 0 && diskNow !== from) {
      log?.warn?.(
        `[harness] partial size changed before Range (wanted ${from}, disk ${diskNow}); using disk`,
      )
    }

    const headers: Record<string, string> = {}
    if (start > 0) {
      headers.Range = `bytes=${start}-`
      log?.info?.(`[harness] resume download from byte ${start} → ${url}`)
    }

    const res = await httpFetch(url, { headers })

    if (res.status === 416 && start > 0) {
      try {
        const head = await httpFetch(url, { method: 'HEAD' })
        const len = Number(head.headers.get('content-length') ?? 0)
        if (len > 0 && start === len) {
          log?.info?.(`[harness] partial already complete (${len} B); reusing`)
          return hashExistingFile(destPath, onProgress)
        }
      } catch {
        /* fall through */
      }
      log?.warn?.(`[harness] Range 416 for ${url}; discarding partial and restarting`)
      rmSync(destPath, { force: true })
      return tryOnce(0)
    }

    if (res.status === 206) {
      const cr = parseContentRange(res.headers.get('content-range'))
      if (cr && cr.start !== start) {
        log?.warn?.(
          `[harness] Content-Range start ${cr.start} ≠ local ${start}; restarting`,
        )
        rmSync(destPath, { force: true })
        return tryOnce(0)
      }
      const total = cr?.total ?? (start + Number(res.headers.get('content-length') ?? 0))
      try {
        return await streamResponseToFile(res, destPath, onProgress, {
          resumeFrom: start,
          append: true,
          totalBytes: total > 0 ? total : undefined,
          keepPartialOnError: true,
        })
      } catch (err) {
        if (err instanceof Error && /partial size mismatch/i.test(err.message)) {
          log?.warn?.(`[harness] ${err.message}; discarding partial and restarting`)
          rmSync(destPath, { force: true })
          return tryOnce(0)
        }
        throw err
      }
    }

    if (res.status === 200) {
      if (start > 0) {
        log?.info?.(`[harness] server ignored Range for ${url}; full re-download`)
        try {
          rmSync(destPath, { force: true })
        } catch {
          /* ignore */
        }
      }
      const total = Number(res.headers.get('content-length') ?? 0)
      return streamResponseToFile(res, destPath, onProgress, {
        resumeFrom: 0,
        append: false,
        totalBytes: total > 0 ? total : undefined,
        keepPartialOnError: true,
      })
    }

    if (!res.ok) throw new Error(`tarball GET ${url} → ${res.status}`)
    return streamResponseToFile(res, destPath, onProgress, {
      keepPartialOnError: true,
    })
  }

  return tryOnce(existing)
}

/** Default download implementation for CLI and desktop (Range-resumable). */
export function createResumableDownloadToFile(
  httpFetch: HttpFetch,
  log?: ResumableLog,
): DownloadToFile {
  return (url, destPath, onProgress) =>
    downloadResumableToFile(httpFetch, url, destPath, onProgress, log)
}
