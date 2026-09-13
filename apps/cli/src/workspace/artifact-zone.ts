/**
 * Node side of the session sync zone (`docs/design/session-sync-zone.md` §5).
 *
 * `<syncRoot>/<sessionId>/<producer>/<file>` mirrors the desktop's layout.
 * Everything here is scoped to one session directory with the same
 * `resolveProjectPath` the workspace uses, so traversal, cross-session paths
 * and symlink escapes fail closed. The zone lies outside every project on
 * purpose: `workspace.*` cannot see it and this service cannot see a project.
 *
 * Upload contract (`put`): one `transferId` per file; chunks arrive in order
 * (offset must equal bytes written so far → else `conflict`), a repeated chunk
 * at an already-written offset is acknowledged and dropped (idempotent retry),
 * a second transfer for a path already being written gets `busy`. Bytes land
 * in `<file>.part.<transferId>`; on `final` the sha256 of the whole file is
 * verified and the part is renamed into place, so a reader never sees a half
 * file. `delete` tombstones the session directory until it returns, so a
 * transfer landing after a delete cannot recreate it.
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  ARTIFACT_CHUNK_BYTES,
  type ArtifactGetRequest,
  type ArtifactGetResult,
  type ArtifactPutRequest,
  type ArtifactPutResult,
  type ArtifactStatResult,
} from '@superone/shared/environment'
import { resolveProjectPath } from './path-security'

/** Largest window one `get` returns; a whole file streams as a series of these. */
export const ARTIFACT_MAX_GET_BYTES = ARTIFACT_CHUNK_BYTES

interface Transfer {
  transferId: string
  sessionId: string
  relativePath: string
  absolutePath: string
  partPath: string
  fd: number
  written: number
  total: number
  sha256: string
  hash: ReturnType<typeof createHash>
  lastActivityAt: number
}

function rpcError(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}

function sessionKey(sessionId: string, relativePath: string): string {
  return `${sessionId}\0${relativePath}`
}

export class ArtifactZoneService {
  private readonly transfers = new Map<string, Transfer>()
  /** `sessionId + relativePath` → transferId of the upload currently writing it. */
  private readonly writing = new Map<string, string>()
  private readonly tombstones = new Set<string>()

  constructor(readonly syncRoot: string) {}

  /** A zone id is one path component; refuse anything that could climb. */
  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
      throw rpcError('invalid_argument', 'sessionId must be a single path component')
    }
    return join(this.syncRoot, sessionId)
  }

  /** Absolute path of `<sessionId>/<relativePath>`, or an `invalid_argument` error. */
  resolve(sessionId: string, relativePath: string): string {
    const dir = this.sessionDir(sessionId)
    if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath === '.' || relativePath.endsWith('/')) {
      throw rpcError('invalid_argument', 'relativePath must name a file inside the session zone')
    }
    const resolved = resolveProjectPath(dir, relativePath.replace(/\\/g, '/'))
    if (!resolved.ok) throw rpcError('invalid_argument', resolved.reason)
    // `a/..` normalises to the session directory itself; that is not a file either.
    const self = resolveProjectPath(dir, '.')
    if (self.ok && resolved.absolutePath === self.absolutePath) {
      throw rpcError('invalid_argument', 'relativePath must name a file inside the session zone')
    }
    return resolved.absolutePath
  }

  stat(sessionId: string, relativePath: string): ArtifactStatResult {
    const abs = this.resolve(sessionId, relativePath)
    try {
      const st = statSync(abs)
      if (!st.isFile()) return { exists: false, size: 0, mtimeMs: 0 }
      return { exists: true, size: st.size, mtimeMs: Math.floor(st.mtimeMs) }
    } catch {
      return { exists: false, size: 0, mtimeMs: 0 }
    }
  }

  put(req: ArtifactPutRequest): ArtifactPutResult {
    const { sessionId, relativePath, transferId } = req
    if (typeof transferId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(transferId)) {
      throw rpcError('invalid_argument', 'transferId must be a short opaque token')
    }
    if (!Number.isSafeInteger(req.offset) || req.offset < 0) throw rpcError('invalid_argument', 'offset must be a non-negative integer')
    if (!Number.isSafeInteger(req.total) || req.total < 0) throw rpcError('invalid_argument', 'total must be a non-negative integer')
    if (typeof req.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(req.sha256)) throw rpcError('invalid_argument', 'sha256 must be a hex digest')
    if (this.tombstones.has(sessionId)) throw rpcError('failed_precondition', 'session zone is being deleted')
    const abs = this.resolve(sessionId, relativePath)
    const chunk = Buffer.from(typeof req.chunk === 'string' ? req.chunk : '', 'base64')
    if (chunk.length > ARTIFACT_CHUNK_BYTES) throw rpcError('invalid_argument', `chunk exceeds ${ARTIFACT_CHUNK_BYTES} bytes`)

    let transfer = this.transfers.get(transferId)
    if (!transfer) {
      if (req.offset !== 0) throw rpcError('conflict', 'unknown transfer: expected offset 0', { expectedOffset: 0 })
      const key = sessionKey(sessionId, relativePath)
      const active = this.writing.get(key)
      if (active && active !== transferId) throw rpcError('busy', 'another transfer is writing this path', { transferId: active })
      transfer = this.open(sessionId, relativePath, abs, transferId, req)
    } else if (transfer.sessionId !== sessionId || transfer.relativePath !== relativePath) {
      throw rpcError('conflict', 'transferId belongs to a different path')
    }
    transfer.lastActivityAt = Date.now()

    if (req.offset < transfer.written) {
      // Idempotent retry of a chunk the node already has — acknowledge, write nothing.
      if (req.offset + chunk.length > transfer.written) {
        throw rpcError('conflict', 'chunk overlaps the write cursor', { expectedOffset: transfer.written })
      }
      return { ok: true, bytesWritten: transfer.written }
    }
    if (req.offset !== transfer.written) {
      throw rpcError('conflict', `gap: expected offset ${transfer.written}`, { expectedOffset: transfer.written })
    }
    if (transfer.written + chunk.length > transfer.total) {
      this.abandon(transfer)
      throw rpcError('invalid_argument', 'chunk runs past the declared total')
    }

    if (chunk.length > 0) {
      writeSync(transfer.fd, chunk, 0, chunk.length, transfer.written)
      transfer.hash.update(chunk)
      transfer.written += chunk.length
    }
    if (!req.final) return { ok: true, bytesWritten: transfer.written }

    if (transfer.written !== transfer.total) {
      this.abandon(transfer)
      throw rpcError('invalid_argument', `final chunk arrived at ${transfer.written} of ${transfer.total} bytes`)
    }
    const digest = transfer.hash.digest('hex')
    if (digest !== transfer.sha256) {
      this.abandon(transfer)
      throw rpcError('invalid_argument', 'sha256 mismatch', { expected: transfer.sha256, actual: digest })
    }
    closeSync(transfer.fd)
    if (this.tombstones.has(sessionId)) {
      this.forget(transfer, true)
      throw rpcError('failed_precondition', 'session zone was deleted during the transfer')
    }
    renameSync(transfer.partPath, transfer.absolutePath)
    this.forget(transfer, false)
    return { ok: true, bytesWritten: transfer.written, mtimeMs: Math.floor(statSync(transfer.absolutePath).mtimeMs) }
  }

  get(req: ArtifactGetRequest): ArtifactGetResult {
    const abs = this.resolve(req.sessionId, req.relativePath)
    const offset = Number.isSafeInteger(req.offset) && req.offset >= 0 ? req.offset : 0
    const maxBytes = Number.isSafeInteger(req.maxBytes) && req.maxBytes > 0
      ? Math.min(req.maxBytes, ARTIFACT_MAX_GET_BYTES)
      : ARTIFACT_MAX_GET_BYTES
    let fd: number
    try {
      fd = openSync(abs, 'r')
    } catch {
      throw rpcError('not_found', 'artifact not found')
    }
    try {
      const st = fstatSync(fd)
      if (!st.isFile()) throw rpcError('not_found', 'artifact not found')
      const toRead = Math.min(maxBytes, Math.max(0, st.size - offset))
      const slice = Buffer.alloc(toRead)
      if (toRead > 0) readSync(fd, slice, 0, toRead, offset)
      return {
        chunk: slice.toString('base64'),
        total: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        eof: offset + toRead >= st.size,
      }
    } finally {
      closeSync(fd)
    }
  }

  /**
   * Remove one artifact or the whole session directory. The session is
   * tombstoned until the removal returns, so a chunk landing meanwhile cannot
   * resurrect the directory.
   */
  async delete(sessionId: string, relativePath?: string): Promise<void> {
    if (relativePath !== undefined) {
      const abs = this.resolve(sessionId, relativePath)
      for (const transfer of [...this.transfers.values()]) {
        if (transfer.absolutePath === abs) this.abandon(transfer)
      }
      await rm(abs, { force: true })
      return
    }
    const dir = this.sessionDir(sessionId)
    this.tombstones.add(sessionId)
    try {
      for (const transfer of [...this.transfers.values()]) {
        if (transfer.sessionId === sessionId) this.abandon(transfer)
      }
      await rm(dir, { recursive: true, force: true })
    } finally {
      this.tombstones.delete(sessionId)
    }
  }

  /** Tests / diagnostics. */
  activeTransfers(): string[] {
    return [...this.transfers.keys()]
  }

  private open(sessionId: string, relativePath: string, abs: string, transferId: string, req: ArtifactPutRequest): Transfer {
    mkdirSync(dirname(abs), { recursive: true })
    // A crashed upload leaves a part file behind; the next put for that path removes it.
    for (const name of readdirSync(dirname(abs))) {
      if (name.startsWith(`${basename(abs)}.part.`)) {
        try { unlinkSync(join(dirname(abs), name)) } catch { /* already gone */ }
      }
    }
    const partPath = `${abs}.part.${transferId}`
    const fd = openSync(partPath, 'w')
    const transfer: Transfer = {
      transferId,
      sessionId,
      relativePath,
      absolutePath: abs,
      partPath,
      fd,
      written: 0,
      total: req.total,
      sha256: req.sha256,
      hash: createHash('sha256'),
      lastActivityAt: Date.now(),
    }
    this.transfers.set(transferId, transfer)
    this.writing.set(sessionKey(sessionId, relativePath), transferId)
    return transfer
  }

  private abandon(transfer: Transfer): void {
    try { closeSync(transfer.fd) } catch { /* closed on final */ }
    this.forget(transfer, true)
  }

  private forget(transfer: Transfer, removePart: boolean): void {
    if (removePart) {
      try { unlinkSync(transfer.partPath) } catch { /* never written or already gone */ }
    }
    this.transfers.delete(transfer.transferId)
    const key = sessionKey(transfer.sessionId, transfer.relativePath)
    if (this.writing.get(key) === transfer.transferId) this.writing.delete(key)
  }
}
