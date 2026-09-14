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
 * in `<session>/.parts/<transferId>` — a reserved directory no relativePath
 * may name, so staging can neither be read through `get` nor collide with a
 * real artifact; on `final` the sha256 of the whole file is verified and the
 * part is renamed into place, so a reader never sees a half file. `delete`
 * tombstones the session directory until it returns, so a transfer landing
 * after a delete cannot recreate it.
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
  lstatSync,
  realpathSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
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

/** Staging directory inside each session zone; never addressable through the contract. */
const PARTS_DIR = '.parts'
/** How many finished-upload receipts to keep for late re-sends. */
const COMPLETED_RECEIPTS = 512

function rpcError(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}


export class ArtifactZoneService {
  private readonly transfers = new Map<string, Transfer>()
  /**
   * Receipts of finished uploads, so a final chunk re-sent after its reply was
   * lost is acknowledged instead of being taken for a new upload that would
   * overwrite whatever landed since. Bounded; insertion-ordered eviction.
   */
  private readonly completed = new Map<string, { absolutePath: string; sha256: string; total: number }>()
  /** Canonical absolute path → transferId of the upload currently writing it. */
  private readonly writing = new Map<string, string>()
  private readonly tombstones = new Set<string>()
  /** An upload that has not sent a chunk for this long is presumed lost; its path is free again. */
  readonly idleTransferTtlMs = 10 * 60_000
  /**
   * `syncRoot` with symlinks resolved. Every path the service handles is built
   * from this, so one file has one spelling from the first chunk to the rename
   * — `resolveProjectPath` realpaths an existing root and leaves a missing one
   * alone, which would otherwise give the first chunk of a fresh session a
   * different absolute path from the second. `syncRoot` itself stays as
   * configured: it is what the descriptor advertises and what the agent's
   * `SUPERONE_SESSION_DIR` is built from.
   */
  private readonly realRoot: string

  constructor(readonly syncRoot: string) {
    let real = resolve(syncRoot)
    try {
      mkdirSync(real, { recursive: true })
      real = realpathSync(real)
    } catch {
      /* unwritable root: keep the textual path; every operation will fail with a clear error */
    }
    this.realRoot = real
  }

  /**
   * A zone id is one path component; refuse anything that could climb. The
   * directory is the authorisation boundary, so it must be a real directory:
   * a link there would let one session's controller reach another's files
   * through `resolveProjectPath`, which follows the root before checking.
   */
  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
      throw rpcError('invalid_argument', 'sessionId must be a single path component')
    }
    const dir = join(this.realRoot, sessionId)
    try {
      if (lstatSync(dir).isSymbolicLink()) throw rpcError('invalid_argument', 'session zone must be a real directory')
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err
    }
    return dir
  }

  /** Absolute path of `<sessionId>/<relativePath>`, or an `invalid_argument` error. */
  resolve(sessionId: string, relativePath: string): string {
    const dir = this.sessionDir(sessionId)
    if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath === '.' || relativePath.endsWith('/')) {
      throw rpcError('invalid_argument', 'relativePath must name a file inside the session zone')
    }
    const resolved = resolveProjectPath(dir, relativePath.replace(/\\/g, '/'))
    if (!resolved.ok) throw rpcError('invalid_argument', resolved.reason)
    // Checked on the *resolved* path, not the spelling: `agent/../.parts/x`
    // and `./.parts/x` both name the staging area.
    const partsRoot = join(dir, PARTS_DIR)
    if (resolved.absolutePath === partsRoot || resolved.absolutePath.startsWith(partsRoot + sep)) {
      throw rpcError('invalid_argument', `${PARTS_DIR} is reserved for uploads in progress`)
    }
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
      const receipt = this.completed.get(transferId)
      if (receipt) {
        if (receipt.absolutePath !== abs || receipt.sha256 !== req.sha256 || receipt.total !== req.total) {
          throw rpcError('conflict', 'transferId was already used for a different upload')
        }
        return { ok: true, bytesWritten: receipt.total }
      }
      if (req.offset !== 0) throw rpcError('conflict', 'unknown transfer: expected offset 0', { expectedOffset: 0 })
      this.expireIdleTransfers()
      const active = this.writing.get(abs)
      if (active && active !== transferId) throw rpcError('busy', 'another transfer is writing this path', { transferId: active })
      transfer = this.open(sessionId, relativePath, abs, transferId, req)
    } else if (transfer.sessionId !== sessionId || transfer.absolutePath !== abs) {
      throw rpcError('conflict', 'transferId belongs to a different path')
    } else if (transfer.total !== req.total || transfer.sha256 !== req.sha256) {
      // Same id, different file. A retry that re-read a changed source is a
      // new upload, and treating it as this one acknowledges bytes nobody wrote.
      this.abandon(transfer)
      throw rpcError('conflict', 'transferId was opened for different content', { expectedOffset: 0 })
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
    this.completed.set(transferId, { absolutePath: transfer.absolutePath, sha256: transfer.sha256, total: transfer.total })
    if (this.completed.size > COMPLETED_RECEIPTS) this.completed.delete(this.completed.keys().next().value!)
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

  /**
   * Drop uploads that went quiet: a desktop that lost its connection mid-file
   * retries later under a new transferId, and must not meet `busy` until the
   * node restarts. Called lazily from `put`; no timer to leak.
   */
  expireIdleTransfers(now = Date.now()): void {
    for (const transfer of [...this.transfers.values()]) {
      if (transfer.lastActivityAt + this.idleTransferTtlMs <= now) this.abandon(transfer)
    }
  }

  private open(sessionId: string, relativePath: string, abs: string, transferId: string, req: ArtifactPutRequest): Transfer {
    mkdirSync(dirname(abs), { recursive: true })
    const partsDir = this.stagingDir(sessionId)
    this.sweepStaleParts(partsDir)
    const partPath = join(partsDir, transferId)
    // Exclusive create: a transferId is one upload; a leftover under the same
    // id is a crashed one, removed rather than appended to.
    try { unlinkSync(partPath) } catch { /* nothing staged */ }
    const fd = openSync(partPath, 'wx')
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
    this.writing.set(abs, transferId)
    return transfer
  }

  /**
   * The session's staging directory, created if missing and refused if it is
   * anything but a real directory. `mkdir -p` follows a symlink and
   * `openSync(..., 'wx')` only guards the leaf, so a link planted here would
   * put upload bytes outside the zone entirely.
   */
  private stagingDir(sessionId: string): string {
    const dir = join(this.sessionDir(sessionId), PARTS_DIR)
    try {
      const st = lstatSync(dir)
      if (!st.isDirectory()) {
        throw rpcError('failed_precondition', `${PARTS_DIR} must be a real directory`)
      }
      return dir
    } catch (err) {
      if ((err as { code?: string }).code === 'failed_precondition') throw err
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    mkdirSync(dir, { recursive: true })
    if (lstatSync(dir).isSymbolicLink()) {
      throw rpcError('failed_precondition', `${PARTS_DIR} must be a real directory`)
    }
    return dir
  }

  /** Staging a node crash left behind: nothing tracks it, so age is the only signal. */
  private sweepStaleParts(partsDir: string): void {
    const cutoff = Date.now() - this.idleTransferTtlMs
    for (const name of readdirSync(partsDir)) {
      if (this.transfers.has(name)) continue
      const path = join(partsDir, name)
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
      } catch { /* already gone */ }
    }
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
    if (this.writing.get(transfer.absolutePath) === transfer.transferId) this.writing.delete(transfer.absolutePath)
  }
}
