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
import { closeSync, createReadStream, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs'
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
  if (signal?.aborted) throw Object.assign(new Error('artifact transfer aborted'), { code: 'aborted' })
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** How many times one upload tolerates the node answering with a different offset. */
const MAX_OFFSET_RESYNCS = 3

export async function uploadArtifact(opts: UploadArtifactOptions): Promise<TransferOutcome> {
  throwIfAborted(opts.signal)
  const total = statSync(opts.localPath).size
  const sha256 = await sha256File(opts.localPath)
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
        if (typeof result.mtimeMs === 'number') stampMtime(opts.localPath, result.mtimeMs)
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
}

export async function downloadArtifact(opts: DownloadArtifactOptions): Promise<TransferOutcome & { mtimeMs: number }> {
  throwIfAborted(opts.signal)
  mkdirSync(dirname(opts.destPath), { recursive: true })
  const partPath = `${opts.destPath}.part.${randomUUID()}`
  const fd = openSync(partPath, 'w')
  let offset = 0
  let ms = 0
  let mtimeMs = 0
  try {
    for (;;) {
      const started = Date.now()
      const res = await opts.get({ sessionId: opts.sessionId, relativePath: opts.relativePath, offset, maxBytes: ARTIFACT_CHUNK_BYTES })
      ms += Date.now() - started
      throwIfAborted(opts.signal)
      const chunk = Buffer.from(res.chunk, 'base64')
      if (chunk.length > 0) writeSync(fd, chunk, 0, chunk.length, offset)
      offset += chunk.length
      mtimeMs = res.mtimeMs
      if (res.eof) break
      if (chunk.length === 0) throw new Error('artifact.get returned no bytes before eof')
    }
    closeSync(fd)
    renameSync(partPath, opts.destPath)
    stampMtime(opts.destPath, mtimeMs)
  } catch (err) {
    try { closeSync(fd) } catch { /* closed above */ }
    try { unlinkSync(partPath) } catch { /* never written */ }
    throw err
  }
  return { bytes: offset, ms, mtimeMs }
}

function stampMtime(path: string, mtimeMs: number): void {
  try {
    const seconds = mtimeMs / 1000
    utimesSync(path, seconds, seconds)
  } catch {
    /* a copy with the wrong mtime is re-fetched once; not fatal */
  }
}
