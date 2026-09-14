/**
 * Moving one artifact between the desktop zone and a node zone over the
 * `artifact.*` RPCs (`docs/design/session-sync-zone.md` §5.2).
 *
 * Upload streams `ARTIFACT_CHUNK_BYTES` windows in order under one transfer
 * id; a `conflict` carrying the node's expected offset resumes from there,
 * which is also how a job continues after a disconnect. Download writes a
 * `.part` next to the target and renames it on `eof`. Both stamp the local
 * copy with the node's mtime, so the two sides agree on `size + mtime` — the
 * check the lazy mirror uses to decide a copy is still current (§4.2).
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createReadStream, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, utimesSync, writeSync, ftruncateSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ARTIFACT_CHUNK_BYTES,
  type ArtifactGetRequest,
  type ArtifactGetResult,
  type ArtifactPutRequest,
  type ArtifactPutResult,
} from '@superone/shared/environment'

export type ArtifactPutFn = (input: ArtifactPutRequest) => Promise<ArtifactPutResult>
export type ArtifactGetFn = (input: ArtifactGetRequest) => Promise<ArtifactGetResult>

export interface UploadArtifactOptions {
  localPath: string
  sessionId: string
  relativePath: string
  transferId?: string
  /** Bytes the node already holds (job resume). */
  offset?: number
  put: ArtifactPutFn
  signal?: AbortSignal
  onProgress?: (offset: number, total: number) => void
}

export interface TransferOutcome {
  bytes: number
  /** Wall time spent in RPC, for throughput measurement. */
  ms: number
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}

function aborted(): Error {
  return Object.assign(new Error('artifact transfer aborted'), { code: 'aborted' })
}

/**
 * Hash the file, giving up as soon as `signal` fires. The hash runs before a
 * single byte is sent, so a transfer whose budget is already spent must not
 * keep reading a large file nobody is waiting for.
 */
export function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(aborted()); return }
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    const stop = () => stream.destroy(aborted())
    signal?.addEventListener('abort', stop, { once: true })
    const clear = () => signal?.removeEventListener('abort', stop)
    stream
      .on('data', (chunk) => hash.update(chunk))
      .on('error', (err) => { clear(); reject(err) })
      .on('end', () => { clear(); resolve(hash.digest('hex')) })
  })
}

/** How many times one upload tolerates the node answering with a different offset. */
const MAX_OFFSET_RESYNCS = 3

export async function uploadArtifact(opts: UploadArtifactOptions): Promise<TransferOutcome> {
  throwIfAborted(opts.signal)
  const source = statSync(opts.localPath)
  const total = source.size
  const sha256 = await sha256File(opts.localPath, opts.signal)
  throwIfAborted(opts.signal)
  const transferId = opts.transferId ?? randomUUID()
  let offset = Math.max(0, Math.min(opts.offset ?? 0, total))
  let resyncs = 0
  let ms = 0
  const fd = openSync(opts.localPath, 'r')
  try {
    // An empty file is a single final chunk of zero bytes.
    do {
      const length = Math.min(ARTIFACT_CHUNK_BYTES, total - offset)
      const chunk = Buffer.alloc(length)
      if (length > 0) readSync(fd, chunk, 0, length, offset)
      const final = offset + length >= total
      const started = Date.now()
      let result: ArtifactPutResult
      try {
        result = await opts.put({
          sessionId: opts.sessionId,
          relativePath: opts.relativePath,
          transferId,
          offset,
          total,
          sha256,
          chunk: chunk.toString('base64'),
          final,
        })
      } catch (err) {
        const expected = (err as { code?: string; details?: { expectedOffset?: number } })
        if (expected.code === 'conflict' && typeof expected.details?.expectedOffset === 'number' && resyncs < MAX_OFFSET_RESYNCS) {
          resyncs++
          offset = Math.max(0, Math.min(expected.details.expectedOffset, total))
          throwIfAborted(opts.signal)
          continue
        }
        throw err
      }
      ms += Date.now() - started
      throwIfAborted(opts.signal)
      offset = result.bytesWritten
      opts.onProgress?.(offset, total)
      if (final && offset >= total) {
        // Only stamp the copy we actually sent. If the local file changed while
        // the upload ran, giving the new bytes the node's mtime for the old
        // ones makes the mirror agree about two different files forever.
        if (typeof result.mtimeMs === 'number' && sameSource(opts.localPath, source)) {
          stampMtime(opts.localPath, result.mtimeMs)
        }
        break
      }
    } while (offset < total)
  } finally {
    closeSync(fd)
  }
  return { bytes: total, ms }
}

export interface DownloadArtifactOptions {
  sessionId: string
  relativePath: string
  destPath: string
  get: ArtifactGetFn
  signal?: AbortSignal
  /**
   * Synchronous last word before the staged bytes replace whatever is at
   * `destPath`. The download itself is a long await, so the caller re-checks
   * here what it checked before starting; throwing refuses the commit and the
   * part is discarded, leaving the existing file untouched.
   */
  beforeCommit?: () => void
}

/** How many times a download starts over because the file changed under it. */
const MAX_VERSION_RESTARTS = 3

export async function downloadArtifact(opts: DownloadArtifactOptions): Promise<TransferOutcome & { mtimeMs: number }> {
  throwIfAborted(opts.signal)
  mkdirSync(dirname(opts.destPath), { recursive: true })
  const partPath = `${opts.destPath}.part.${randomUUID()}`
  const fd = openSync(partPath, 'w')
  let offset = 0
  let ms = 0
  let mtimeMs = 0
  let total = -1
  let restarts = 0
  try {
    for (;;) {
      const started = Date.now()
      const res = await opts.get({ sessionId: opts.sessionId, relativePath: opts.relativePath, offset, maxBytes: ARTIFACT_CHUNK_BYTES })
      ms += Date.now() - started
      throwIfAborted(opts.signal)
      // Every window reports the file's size and mtime; a change means the
      // node replaced the file between windows. Half of each version stamped
      // with the newer mtime would pass the mirror's check for good, so start over.
      if (offset > 0 && (res.total !== total || res.mtimeMs !== mtimeMs)) {
        if (++restarts > MAX_VERSION_RESTARTS) {
          throw Object.assign(new Error('artifact keeps changing while it is being read'), { code: 'conflict' })
        }
        offset = 0
        total = -1
        continue
      }
      const chunk = Buffer.from(res.chunk, 'base64')
      if (chunk.length > 0) writeSync(fd, chunk, 0, chunk.length, offset)
      offset += chunk.length
      mtimeMs = res.mtimeMs
      total = res.total
      if (res.eof) break
      if (chunk.length === 0) throw new Error('artifact.get returned no bytes before eof')
    }
    ftruncateSync(fd, offset)
    closeSync(fd)
    opts.beforeCommit?.()
    renameSync(partPath, opts.destPath)
    stampMtime(opts.destPath, mtimeMs)
  } catch (err) {
    try { closeSync(fd) } catch { /* closed above */ }
    try { unlinkSync(partPath) } catch { /* never written */ }
    throw err
  }
  return { bytes: offset, ms, mtimeMs }
}

/** Is the file still the one the upload read? Identity, size and mtime together. */
function sameSource(path: string, before: import('node:fs').Stats): boolean {
  try {
    const now = statSync(path)
    return now.ino === before.ino && now.size === before.size && now.mtimeMs === before.mtimeMs
  } catch {
    return false
  }
}

function stampMtime(path: string, mtimeMs: number): void {
  try {
    const seconds = mtimeMs / 1000
    utimesSync(path, seconds, seconds)
  } catch {
    /* a copy with the wrong mtime is re-fetched once; not fatal */
  }
}
