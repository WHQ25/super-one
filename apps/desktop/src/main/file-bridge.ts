import { promises as fs, statSync, existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import {
  MODEL_MIME,
  INLINE_RPC_MAX_BYTES,
  isInlinePreviewCandidate,
  isInlineRpcCandidate,
  looksBinary,
  shouldInlineRpcBytes,
} from '@superone/shared/file-preview'
import { isPathAtOrWithinAllowed, isPathWithinAllowed, resolveRealPath } from './path-security'

const FILE_BRIDGE_MIME: Record<string, string> = {
  ...MODEL_MIME,
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif', '.heic': 'image/heic', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html', '.xml': 'application/xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
}

export type FileBridgeErrorCode = 'forbidden_path' | 'not_found' | 'too_large' | 'internal_error'

export class FileBridgeError extends Error {
  constructor(public readonly code: FileBridgeErrorCode, message: string) {
    super(message)
    this.name = 'FileBridgeError'
  }
}

export interface FileBridgeContext {
  allowedRoots: string[]
}

export interface AuthorizedFile {
  realPath: string
  mimeType: string
  size: number
  modifiedAt: number
  name: string
}

const DENY_PATH_SEGMENTS = [
  '/.ssh/', '/.aws/', '/.gnupg/', '/.config/gh/',
  '/.npmrc', '/.netrc', '/.pgpass', '/.git-credentials',
]

const DENY_BASENAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  '.npmrc', '.netrc', '.pgpass', '.git-credentials',
])

const DENY_EXTENSIONS = new Set(['.pem', '.key', '.crt', '.cer', '.p12', '.pfx'])

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

export function canonicalizeRoots(roots: string[]): string[] {
  const canonicalized = roots.filter(Boolean).map((p) => resolveRealPath(normalize(p)))
  return Array.from(new Set(canonicalized))
}

function isDenied(realPath: string): boolean {
  const lower = realPath.replace(/\\/g, '/').toLowerCase()
  for (const seg of DENY_PATH_SEGMENTS) {
    if (lower.includes(seg)) return true
  }
  const base = basename(realPath).toLowerCase()
  if (DENY_BASENAMES.has(base)) return true
  const ext = extname(base).toLowerCase()
  if (DENY_EXTENSIONS.has(ext)) return true
  return false
}

export function inferMimeType(realPath: string): string {
  const ext = extname(realPath).toLowerCase()
  return FILE_BRIDGE_MIME[ext] ?? 'application/octet-stream'
}

export async function authorizeAndStat(
  inputPath: string,
  context: FileBridgeContext,
  opts: { maxBytes?: number; skipRootCheck?: boolean } = {},
): Promise<AuthorizedFile> {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new FileBridgeError('forbidden_path', 'path is required')
  }
  if (!isAbsolute(inputPath)) {
    throw new FileBridgeError('forbidden_path', 'path must be absolute')
  }

  const resolved = resolve(inputPath)
  let realPath: string
  try {
    realPath = await realpath(resolved)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileBridgeError('not_found', 'file does not exist')
    }
    throw new FileBridgeError('internal_error', `realpath failed: ${(err as Error).message}`)
  }

  if (!opts.skipRootCheck) {
    const roots = canonicalizeRoots(context.allowedRoots)
    if (roots.length === 0 || !isPathWithinAllowed(realPath, roots)) {
      throw new FileBridgeError('forbidden_path', 'path not within allowed roots')
    }
  }
  if (isDenied(realPath)) {
    throw new FileBridgeError('forbidden_path', 'path matches blacklist')
  }

  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(realPath)
  } catch {
    throw new FileBridgeError('not_found', 'file stat failed')
  }
  if (!stat.isFile()) {
    throw new FileBridgeError('forbidden_path', 'not a regular file')
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  if (stat.size > maxBytes) {
    throw new FileBridgeError('too_large', `file size ${stat.size} exceeds maxBytes ${maxBytes}`)
  }

  return {
    realPath,
    mimeType: inferMimeType(realPath),
    size: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs),
    name: basename(realPath),
  }
}

/**
 * Read an already-authorized file as UTF-8 text for an in-band preview, or
 * return `null` when it should take the download path instead.
 *
 * The name decides eligibility and the bytes get the final say: a `.txt` that
 * contains a NUL is binary whatever it is called. A `null` here is not an error —
 * the caller falls back to the signed-URL / relay upload path.
 */
export async function readInlinePreviewText(file: AuthorizedFile): Promise<string | null> {
  if (!isInlinePreviewCandidate(file.name, file.size)) return null
  // `size` came from a stat moments ago; re-check after the read so a file that
  // grew in between cannot push an oversized payload onto the RPC channel.
  const bytes = await fs.readFile(file.realPath)
  if (bytes.byteLength > INLINE_RPC_MAX_BYTES || looksBinary(bytes)) return null
  return bytes.toString('utf8')
}

/**
 * Read an already-authorized file for an in-band RPC payload, or `null` when
 * it is too large. Re-checks the byte length after the read so a file that
 * grew cannot push an oversized payload onto the WebSocket.
 */
export async function readInlineRpcBytes(file: AuthorizedFile): Promise<Buffer | null> {
  if (!isInlineRpcCandidate(file.size)) return null
  const bytes = await fs.readFile(file.realPath)
  if (bytes.byteLength > INLINE_RPC_MAX_BYTES) return null
  return bytes
}

export type PreferInlineRead =
  | { kind: 'text'; text: string }
  | { kind: 'bytes'; bytes: Buffer }
  | { kind: 'none' }

/**
 * What `read_desktop_file` with `preferInline` (and the full-fetch path for
 * a small relay file) should send back in-band. Text wins on every transport;
 * small binaries ride the RPC over the relay only.
 */
export async function readPreferInline(
  file: AuthorizedFile,
  opts: { preferInline?: boolean; statOnly?: boolean; transport: 'lan' | 'relay' },
): Promise<PreferInlineRead> {
  if (opts.preferInline) {
    const text = await readInlinePreviewText(file)
    if (text !== null) return { kind: 'text', text }
  }
  if (shouldInlineRpcBytes(opts.transport, file.size) && (opts.preferInline || !opts.statOnly)) {
    const bytes = await readInlineRpcBytes(file)
    if (bytes) return { kind: 'bytes', bytes }
  }
  return { kind: 'none' }
}

export interface AuthorizedWriteTarget {
  realDir: string
  savedPath: string
  name: string
}

export async function authorizeWriteTarget(
  targetDir: string,
  fileName: string,
  context: FileBridgeContext,
): Promise<AuthorizedWriteTarget> {
  if (!targetDir || typeof targetDir !== 'string' || !isAbsolute(targetDir)) {
    throw new FileBridgeError('forbidden_path', 'targetDir must be an absolute path')
  }
  const safeName = basename((fileName ?? '').trim())
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new FileBridgeError('forbidden_path', 'invalid file name')
  }

  let realDir: string
  try {
    realDir = await realpath(resolve(targetDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileBridgeError('forbidden_path', 'target dir does not exist')
    }
    throw new FileBridgeError('internal_error', `realpath failed: ${(err as Error).message}`)
  }

  let dirStat: import('node:fs').Stats
  try {
    dirStat = await fs.stat(realDir)
  } catch {
    throw new FileBridgeError('forbidden_path', 'target dir stat failed')
  }
  if (!dirStat.isDirectory()) {
    throw new FileBridgeError('forbidden_path', 'target is not a directory')
  }

  const roots = canonicalizeRoots(context.allowedRoots)
  if (roots.length === 0 || !isPathAtOrWithinAllowed(realDir, roots)) {
    throw new FileBridgeError('forbidden_path', 'target dir not within allowed roots')
  }
  if (isDenied(join(realDir, safeName))) {
    throw new FileBridgeError('forbidden_path', 'file name matches blacklist')
  }

  const savedPath = dedupeWritePath(join(realDir, safeName))
  return { realDir, savedPath, name: basename(savedPath) }
}

function dedupeWritePath(target: string): string {
  if (!existsSync(target)) return target
  const dir = dirname(target)
  const ext = extname(target)
  const stem = basename(target, ext)
  for (let i = 1; i < 10_000; i++) {
    const candidate = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new FileBridgeError('internal_error', 'could not find a free filename')
}

export function statAuthorizedSync(realPath: string): { size: number; mimeType: string } | null {
  try {
    const st = statSync(realPath)
    if (!st.isFile()) return null
    return { size: st.size, mimeType: inferMimeType(realPath) }
  } catch {
    return null
  }
}
