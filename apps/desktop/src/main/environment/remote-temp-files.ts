import { createHash, randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { TEMP_FILE_CHUNK_BYTES, type TempFileReadRequest, type TempFileReadResult, type TempFileStatResult } from '@superone/shared/environment'

export type RemoteTempFileResolution =
  | { kind: 'local'; path: string; size: number }
  | { kind: 'missing' }
  | { kind: 'outside' }

export interface RemoteTempFileSource {
  stat(path: string): Promise<TempFileStatResult>
  read(input: TempFileReadRequest): Promise<TempFileReadResult>
}

let cacheRoot: string | undefined
const pending = new Map<string, Promise<RemoteTempFileResolution>>()
const stamps = new Map<string, { size: number; mtimeMs: number }>()

/** Node-authoritative, chunked copies for all desktop/phone file consumers. */
export function materializeRemoteTempFile(
  connectionId: string,
  path: string,
  source: RemoteTempFileSource,
): Promise<RemoteTempFileResolution> {
  const key = createHash('sha256').update(`${connectionId}\0${path}`).digest('hex')
  const running = pending.get(key)
  if (running) return running
  const promise = copy(key, path, source).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

async function copy(key: string, path: string, source: RemoteTempFileSource): Promise<RemoteTempFileResolution> {
  let remote: TempFileStatResult
  try {
    remote = await source.stat(path)
  } catch (err) {
    if ((err as { code?: string }).code === 'forbidden') return { kind: 'outside' }
    throw err
  }
  if (!remote.exists) return { kind: 'missing' }
  if (!Number.isSafeInteger(remote.size) || remote.size < 0 || !Number.isFinite(remote.mtimeMs)) {
    throw new Error('invalid temporary file metadata')
  }
  // A private per-process root avoids sharing writable cache paths with other
  // local users. The node path remains the identity carried in chat payloads.
  cacheRoot ??= mkdtempSync(join(tmpdir(), 'super-one-remote-temp-'))
  const local = join(cacheRoot, key, basename(path.replace(/\\/g, '/')))
  try {
    const st = statSync(local)
    const stamp = stamps.get(key)
    // Keep the node's exact stamp: local utimes may round sub-millisecond
    // precision, but two same-size writes within a millisecond still differ.
    if (stamp?.size === remote.size && stamp.mtimeMs === remote.mtimeMs &&
        st.isFile() && st.size === remote.size && Math.floor(st.mtimeMs) === Math.floor(remote.mtimeMs)) {
      return { kind: 'local', path: local, size: remote.size }
    }
  } catch { /* not cached */ }
  mkdirSync(dirname(local), { recursive: true })
  const part = `${local}.part.${randomUUID()}`
  const fd = openSync(part, 'wx', 0o600)
  let complete = false
  try {
    let offset = 0
    do {
      const chunk = await source.read({ path, offset, maxBytes: TEMP_FILE_CHUNK_BYTES })
      const bytes = Buffer.from(chunk.chunk, 'base64')
      if (chunk.total !== remote.size || chunk.mtimeMs !== remote.mtimeMs ||
          bytes.length > TEMP_FILE_CHUNK_BYTES || offset + bytes.length > remote.size ||
          chunk.eof !== (offset + bytes.length === remote.size) || (!bytes.length && !chunk.eof)) {
        throw new Error('temporary file changed or transfer was truncated; retry the preview')
      }
      let written = 0
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written)
      offset += bytes.length
      if (chunk.eof) break
    } while (offset < remote.size)
    const final = await source.stat(path)
    if (!final.exists || final.size !== remote.size || final.mtimeMs !== remote.mtimeMs) {
      throw new Error('temporary file changed during transfer; retry the preview')
    }
    complete = true
  } finally {
    closeSync(fd)
    if (!complete) rmSync(part, { force: true })
  }
  try {
    utimesSync(part, remote.mtimeMs / 1000, remote.mtimeMs / 1000)
    renameSync(part, local)
    stamps.set(key, { size: remote.size, mtimeMs: remote.mtimeMs })
    return { kind: 'local', path: local, size: remote.size }
  } finally {
    rmSync(part, { force: true })
  }
}
