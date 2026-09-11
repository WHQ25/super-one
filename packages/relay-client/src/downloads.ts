import type { ReadDesktopFileResponse, ShareFileEncryption } from '@superone/shared/agent-types'
import {
  FILE_CHUNK_SIZE,
  FILE_ENVELOPE_HEADER_SIZE,
  FILE_GCM_IV_SIZE,
  FILE_GCM_TAG_SIZE,
  decryptBytesChunked,
} from './crypto'
import { substituteLanHost } from './lan-url'

export const MAX_DOWNLOAD_BYTES = 100 * 1_024 * 1_024

export type DownloadProgress = (received: number, total: number) => void

export type HttpGetResponse = {
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
  /** A fetch `Response.body`; when present the download reports incremental progress. */
  body?: ReadableStream<Uint8Array> | null
}

export type HttpGet = (url: string, onProgress?: DownloadProgress) => Promise<HttpGetResponse>

/** A file the desktop staged encrypted on the relay: where it is and how to open it. */
export type EncryptedFile = {
  size: number
  downloadUrl: string
  expiresAt?: number
  encryption: ShareFileEncryption
}

export type DownloadEncryptedFileOptions = {
  file: EncryptedFile
  aesKeyBytes?: Uint8Array | null
  channelKeyHex?: string | null
  get?: HttpGet
  now?: () => number
  onProgress?: DownloadProgress
}

export type DesktopFileResponse = Extract<ReadDesktopFileResponse, { url: string }>

export type DownloadDesktopFileOptions = Omit<DownloadEncryptedFileOptions, 'file'> & {
  file: DesktopFileResponse
  transport: 'lan' | 'relay'
  /** LAN host the phone is connected to; fills the desktop's `{lanHost}` URL placeholder. */
  lanHost?: string
}

function validateSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('download: invalid file size')
  }
  if (size > MAX_DOWNLOAD_BYTES) {
    throw new Error('File too large to download (max 100 MB)')
  }
}

function checkedDownloadUrl(raw: string, protocols: readonly string[] = ['https:']): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('download: invalid URL') }
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error(`download: rejected ${url.protocol || 'unknown'} URL`)
  }
  return url.toString()
}

function encryptedSize(plaintextSize: number): number {
  const chunks = plaintextSize === 0 ? 1 : Math.ceil(plaintextSize / FILE_CHUNK_SIZE)
  return FILE_ENVELOPE_HEADER_SIZE
    + plaintextSize
    + chunks * (FILE_GCM_IV_SIZE + FILE_GCM_TAG_SIZE)
}

const defaultGet: HttpGet = async (url) => fetch(url)

function getUrl(get: HttpGet, url: string, onProgress?: DownloadProgress): Promise<HttpGetResponse> {
  return onProgress ? get(url, onProgress) : get(url)
}

/** Streamed bodies report here; XHR-style getters report via `get(url, onProgress)` instead. */
function progressFrom(response: HttpGetResponse, onProgress?: DownloadProgress): DownloadProgress | undefined {
  const body = response.body
  if (body && typeof body.getReader === 'function') return onProgress
  return undefined
}

async function readBodyBytes(
  response: HttpGetResponse,
  expectedSize: number,
  onProgress: DownloadProgress | undefined,
  mismatchError: string,
): Promise<Uint8Array> {
  const reader = (() => {
    const body = response.body
    if (!body || typeof body.getReader !== 'function') return null
    try { return body.getReader() } catch { return null }
  })()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onProgress?.(bytes.byteLength, expectedSize)
    if (bytes.byteLength !== expectedSize) throw new Error(mismatchError)
    return bytes
  }
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (received + value.byteLength > expectedSize) {
      await reader.cancel().catch(() => {})
      throw new Error(mismatchError)
    }
    chunks.push(value)
    received += value.byteLength
    onProgress?.(received, expectedSize)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (bytes.byteLength !== expectedSize) throw new Error(mismatchError)
  return bytes
}

/** Download and authenticate a file the desktop staged encrypted on the relay. */
export async function downloadEncryptedFileBytes(opts: DownloadEncryptedFileOptions): Promise<Uint8Array> {
  const { file } = opts
  validateSize(file.size)

  if (!file.downloadUrl || !file.encryption) {
    throw new Error('download: missing file data')
  }
  if (file.expiresAt !== undefined && (opts.now ?? Date.now)() >= file.expiresAt) {
    throw new Error('download: link expired')
  }
  if (
    file.encryption.version !== 1
    || file.encryption.format !== 'chunked-v1'
    || !file.encryption.key
  ) {
    throw new Error('download: unsupported encryption metadata')
  }
  if (!opts.aesKeyBytes || !opts.channelKeyHex) {
    throw new Error('download: relay keys unavailable')
  }

  const response = await getUrl(opts.get ?? defaultGet, checkedDownloadUrl(file.downloadUrl), opts.onProgress)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const envelope = await readBodyBytes(
    response,
    encryptedSize(file.size),
    progressFrom(response, opts.onProgress),
    'download: encrypted size mismatch',
  )
  const bytes = decryptBytesChunked(
    opts.aesKeyBytes,
    envelope,
    file.encryption.key,
    opts.channelKeyHex,
  )
  if (bytes.byteLength !== file.size) throw new Error('download: decrypted size mismatch')
  return bytes
}

/** Download a read_desktop_file response, allowing unencrypted HTTP only on the LAN transport. */
export async function downloadDesktopFileBytes(opts: DownloadDesktopFileOptions): Promise<Uint8Array> {
  const { file } = opts
  validateSize(file.size)
  if (file.encryption) {
    return downloadEncryptedFileBytes({
      file: { size: file.size, downloadUrl: file.url, expiresAt: file.expiresAt, encryption: file.encryption },
      aesKeyBytes: opts.aesKeyBytes,
      channelKeyHex: opts.channelKeyHex,
      get: opts.get,
      now: opts.now,
      onProgress: opts.onProgress,
    })
  }
  if (opts.transport !== 'lan') throw new Error('download: unencrypted relay file rejected')
  if ((opts.now ?? Date.now)() >= file.expiresAt) throw new Error('download: link expired')
  // Desktop signs LAN URLs as `http://{lanHost}:port/...`; resolve against the connected host first.
  const url = checkedDownloadUrl(substituteLanHost(file.url, opts.lanHost, 'download'), ['http:', 'https:'])
  const response = await getUrl(opts.get ?? defaultGet, url, opts.onProgress)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  return readBodyBytes(response, file.size, progressFrom(response, opts.onProgress), 'download: file size mismatch')
}
