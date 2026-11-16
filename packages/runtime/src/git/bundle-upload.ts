/**
 * Bundles a controller sends to this host, chunk by chunk, before
 * `git.applyIncomingBranch` lands them. Kept in the OS temp directory and
 * dropped once applied or after {@link UPLOAD_TTL_MS}.
 */
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const MAX_BUNDLE_UPLOAD_BYTES = 2 * 1024 ** 3
const UPLOAD_TTL_MS = 30 * 60_000
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface Upload {
  dir: string
  path: string
  size: number
  timer: ReturnType<typeof setTimeout>
}

const uploads = new Map<string, Upload>()

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'invalid_argument' })
}

/**
 * Write one chunk at `offset`. The first chunk starts the upload; a retried
 * chunk rewrites the same bytes, so a resent request is harmless.
 */
export function writeBundleChunk(uploadId: string, offset: number, chunk: Buffer): { size: number } {
  if (!UPLOAD_ID.test(uploadId)) throw invalid('invalid upload id')
  if (!Number.isSafeInteger(offset) || offset < 0) throw invalid('invalid offset')
  let upload = uploads.get(uploadId)
  if (!upload) {
    if (offset !== 0) throw invalid('upload must start at offset 0')
    const dir = mkdtempSync(join(tmpdir(), 'superone-upload-'))
    const path = join(dir, 'branch.bundle')
    writeFileSync(path, '', { mode: 0o600 })
    const timer = setTimeout(() => discardUpload(uploadId), UPLOAD_TTL_MS)
    timer.unref?.()
    upload = { dir, path, size: 0, timer }
    uploads.set(uploadId, upload)
  }
  if (offset > upload.size) throw invalid('chunk out of order')
  if (offset + chunk.length > MAX_BUNDLE_UPLOAD_BYTES) throw invalid('bundle too large')
  const fd = openSync(upload.path, 'r+')
  try {
    let written = 0
    while (written < chunk.length) written += writeSync(fd, chunk, written, chunk.length - written, offset + written)
  } finally {
    closeSync(fd)
  }
  upload.size = Math.max(upload.size, offset + chunk.length)
  return { size: upload.size }
}

/** The uploaded bundle's path, checked against the size the sender reports. */
export function uploadedBundlePath(uploadId: string, size: number): string {
  const upload = uploads.get(uploadId)
  if (!upload) throw Object.assign(new Error('upload not found'), { code: 'not_found' })
  if (upload.size !== size) throw invalid('upload is incomplete')
  return upload.path
}

export function discardUpload(uploadId: string): void {
  const upload = uploads.get(uploadId)
  if (!upload) return
  clearTimeout(upload.timer)
  uploads.delete(uploadId)
  rmSync(upload.dir, { recursive: true, force: true })
}
