import { closeSync, constants, existsSync, fstatSync, openSync, readSync, statSync, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { TEMP_FILE_CHUNK_BYTES, TEMP_FILE_RPC_METHODS, OPERATION_SCOPES, type TempFileStatResult, type TempFileReadResult } from '@superone/shared/environment'
import { resolveRealPath } from '../fs/path-security'
import { asRecord, mapThrown, requireScopes, type RpcHandlerTable } from './rpc-helpers'
import type { RpcContext } from './rpc-context'

function tempRootForms(): Array<{ resolved: string; real: string }> {
  return [tmpdir(), '/tmp', '/private/tmp'].map((root) => {
    const resolved = resolve(root)
    return { resolved, real: existsSync(resolved) ? resolveRealPath(resolved) : resolved }
  })
}

function underTempRoot(abs: string, roots: Array<{ resolved: string; real: string }>): boolean {
  return roots.some((root) =>
    abs === root.resolved || abs.startsWith(root.resolved + sep)
    || abs === root.real || abs.startsWith(root.real + sep))
}

function tempPath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
    throw Object.assign(new Error('absolute path required'), { code: 'invalid_argument' })
  }
  // Match desktop temporary asset roots on both macOS path forms. A missing
  // file has no realpath, so /var/folders/... would otherwise fail the
  // comparison against tmpdir()'s /private/var realpath and look unauthorized.
  // An existing symlink is still followed and rejected when its target leaves.
  const candidate = resolve(value)
  const roots = tempRootForms()
  const forbid = () => Object.assign(new Error('path is outside temporary directories'), { code: 'forbidden' })
  if (!underTempRoot(candidate, roots)) throw forbid()
  if (existsSync(candidate)) {
    const real = resolveRealPath(candidate)
    if (!underTempRoot(real, roots)) throw forbid()
    return real
  }
  let existing = candidate
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing || !underTempRoot(parent, roots)) throw forbid()
    existing = parent
  }
  if (!underTempRoot(resolveRealPath(existing), roots)) throw forbid()
  return candidate
}

function fileStat(st: Stats): TempFileStatResult {
  if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'invalid_argument' })
  return { exists: true, size: Number(st.size), mtimeMs: Number(st.mtimeMs) }
}

export const TEMP_FILE_HANDLERS: RpcHandlerTable<RpcContext> = {
  [TEMP_FILE_RPC_METHODS.stat]: (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
    if (denied) return denied
    try {
      return { result: fileStat(statSync(tempPath(asRecord(payload).path))) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { result: { exists: false, size: 0, mtimeMs: 0 } satisfies TempFileStatResult }
      }
      return mapThrown(err)
    }
  },
  [TEMP_FILE_RPC_METHODS.read]: (payload, ctx) => {
    const denied = requireScopes(ctx.client, OPERATION_SCOPES.readWorkspace)
    if (denied) return denied
    const p = asRecord(payload)
    if (!Number.isSafeInteger(p.offset) || (p.offset as number) < 0 ||
        !Number.isSafeInteger(p.maxBytes) || (p.maxBytes as number) <= 0) {
      return { error: { code: 'invalid_argument', message: 'offset and maxBytes must be non-negative and positive integers respectively' } }
    }
    try {
      const path = tempPath(p.path)
      // Nonblocking avoids hanging main on a named pipe; no-follow also closes
      // the final-component link race between authorization and open.
      const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
      try {
        const st = fileStat(fstatSync(fd))
        const offset = p.offset as number
        const bytes = Buffer.alloc(Math.min(p.maxBytes as number, TEMP_FILE_CHUNK_BYTES, Math.max(0, st.size - offset)))
        const count = bytes.length ? readSync(fd, bytes, 0, bytes.length, offset) : 0
        return { result: { chunk: bytes.subarray(0, count).toString('base64'), total: st.size, mtimeMs: st.mtimeMs, eof: offset + count >= st.size } satisfies TempFileReadResult }
      } finally {
        closeSync(fd)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { error: { code: 'not_found', message: 'temporary file not found' } }
      return mapThrown(err)
    }
  },
}
